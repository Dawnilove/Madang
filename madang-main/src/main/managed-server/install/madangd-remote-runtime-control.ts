import { MADANGD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/madangd-profile-preflight'
import {
  madangdLaunchCommand,
  parseMadangdReadinessOutput,
  type MadangdLaunchSpec,
  type MadangdReadinessParse
} from './madangd-remote-launch'
import {
  readWindowsMadangdLaunchReport,
  readWindowsMadangdSlotRuntime,
  readWindowsMadangdSlotEntry,
  windowsMadangdLaunchCommand,
  windowsMadangdLaunchRuntimeCommand
} from './madangd-remote-launch-windows'
import {
  MADANGD_READINESS_WAIT_MAX_SECONDS,
  madangdLaunchExitedDuringWait,
  madangdReadinessWaitCommand,
  parseMadangdReadinessWaitOutput
} from './madangd-remote-readiness-wait'
import type { MadangdHostTransport } from '../../ssh/madangd-host-transport'
import { errorMessage } from '../../../shared/error-message'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import {
  currentMadangdFence,
  isMadangdFenceLost,
  MadangdFenceLostError,
  posixMadangdFenceGuard
} from '../activation/madangd-activation-fence-scope'
import { madangdWindowsHomeOpCommand } from './madangd-remote-windows-node'
import { MADANGD_WINDOWS_FENCE_ARG } from '../host-state/madangd-windows-host-fence-ops'
import { isWindowsRemoteHost, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

// Pause even after early host answers to avoid a tight retry loop.
const READINESS_RETRY_PAUSE_MS = 1_000

export type MadangdRemoteExecTarget = {
  conn: MadangdHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  /** Locates the runtime store for host-record scripts; required on Windows, unused elsewhere. */
  remoteHome?: string
}

/** A held activation fence must still name this run before any host step. */
export async function execMadangdRemote(
  target: MadangdRemoteExecTarget,
  command: string,
  signal = target.signal
): Promise<string> {
  const fence = currentMadangdFence()
  const run = (line: string): Promise<string> =>
    execCommand(target.conn, line, {
      wrapCommand: target.host.commandDialect !== 'powershell',
      signal
    })
  try {
    if (!fence) {
      return await run(command)
    }
    if (!isWindowsRemoteHost(target.host)) {
      return await run(`${posixMadangdFenceGuard(fence)} ${command}`)
    }
    // Host ops check ownership internally; other commands need a preceding check.
    if (!command.includes(MADANGD_WINDOWS_FENCE_ARG) && target.remoteHome) {
      await run(madangdWindowsHomeOpCommand(target.host, target.remoteHome, 'fence-check', []))
    }
    return await run(command)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    throw isMadangdFenceLost(error) ? new MadangdFenceLostError() : error
  }
}

/** Only confirmed failures use fallback; unconfirmed failures and lost fences propagate. */
export function execMadangdRemoteOr(
  target: MadangdRemoteExecTarget,
  command: string,
  fallback = ''
): Promise<string> {
  return execMadangdRemote(target, command).catch((error: unknown) => {
    if (isUnconfirmedSshCommandTermination(error) || error instanceof MadangdFenceLostError) {
      throw error
    }
    return fallback
  })
}

/** Recovery paths must finish even when the request that started them was cancelled. */
export function withoutAbortSignal<T extends { signal?: AbortSignal }>(
  options: T
): Omit<T, 'signal'> {
  const { signal: _signal, ...rest } = options
  return rest
}

export async function launchMadangdAndAwaitReadiness(
  target: MadangdRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: MadangdLaunchSpec
): Promise<MadangdReadinessParse> {
  if (isWindowsRemoteHost(target.host)) {
    const slotAnswer = await execMadangdRemote(
      target,
      windowsMadangdLaunchRuntimeCommand(target.host, spec.remoteInstallDir)
    )
    const slotRuntime = readWindowsMadangdSlotRuntime(slotAnswer)
    const slotEntry = readWindowsMadangdSlotEntry(slotAnswer, target.host, spec.remoteInstallDir)
    readWindowsMadangdLaunchReport(
      await execMadangdRemote(
        target,
        windowsMadangdLaunchCommand(target.host, spec, slotRuntime, slotEntry)
      )
    )
  } else {
    await execMadangdRemote(
      target,
      madangdLaunchCommand(
        target.host,
        spec,
        target.conn.madangdLaunchDetach ?? 'nohup',
        (await target.conn.madangdLaunchEnv?.()) ?? []
      )
    )
  }
  const deadline = Date.now() + (target.readinessTimeoutMs ?? MADANGD_STARTUP_READINESS_TIMEOUT_MS)
  const sleep = target.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let last = parseMadangdReadinessOutput('')
  let lastWaitError: unknown
  // Always read once, even if client scheduling outlasted the deadline.
  for (let first = true; first || Date.now() < deadline; first = false) {
    target.signal?.throwIfAborted()
    const waitSeconds = Math.min(
      MADANGD_READINESS_WAIT_MAX_SECONDS,
      Math.ceil((deadline - Date.now()) / 1000)
    )
    let output: string
    try {
      output = await execMadangdRemote(
        target,
        madangdReadinessWaitCommand(target.host, spec.remoteInstallDir, waitSeconds)
      )
    } catch (error) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        isUnconfirmedSshCommandTermination(error) ||
        error instanceof MadangdFenceLostError
      ) {
        throw error
      }
      // Failed reads do not prove launch failure; stopping here could kill a healthy candidate.
      lastWaitError = error
      console.warn(`[madangd] readiness wait failed; retrying: ${errorMessage(error)}`)
      await sleep(READINESS_RETRY_PAUSE_MS)
      continue
    }
    target.signal?.throwIfAborted()
    lastWaitError = undefined
    last = parseMadangdReadinessWaitOutput(target.host, output)
    // An exited launch answers as the deadline would, so callers attach the same log tail.
    if (last.state !== 'pending' || madangdLaunchExitedDuringWait(target.host, output)) {
      return last
    }
    await sleep(READINESS_RETRY_PAUSE_MS)
  }
  if (lastWaitError !== undefined) {
    throw lastWaitError
  }
  return last
}
