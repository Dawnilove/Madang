// Readiness and instance-lock records must agree before the slot's own build requests a stop.
import { randomUUID } from 'node:crypto'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { selectMadangdSlotRuntimeCommand } from '../install/madangd-remote-runtime'
import {
  parseMadangdReadinessWaitOutput,
  readMadangdReadinessNowCommand
} from '../install/madangd-remote-readiness-wait'
import { execMadangdRemote } from '../install/madangd-remote-runtime-control'
import { readBoundedMadangdRemoteRecord } from '../install/madangd-remote-record-file'
import { madangdSlotDir, type MadangdSlotOptions } from '../../ssh/madangd-recovery-slot'
import { isWindowsRemoteHost, joinRemotePath } from '../../ssh/ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import {
  madangdWindowsNodeCommandLine,
  madangdWindowsSlotOpCommand,
  readMadangdWindowsEncodedAnswer
} from '../install/madangd-remote-windows-node'
import { MADANGD_WINDOWS_RUNTIME_MARKER } from '../host-state/madangd-windows-host-script'
import { MADANGD_LOCK_FILE_NAME, parseMadangdInstanceLockRecord } from '../../madangd/madangd-instance-lock'
import {
  MADANGD_CANCEL_MANAGED_STOP_FLAG,
  MADANGD_COMPLETE_MANAGED_STOP_FLAG,
  MADANGD_MANAGED_STOP_REQUEST_FILE_FLAG,
  MADANGD_STOP_REQUESTS_CAPABILITY,
  MadangdManagedStopCancellationSchema,
  MadangdManagedStopCompletionSchema,
  type MadangdManagedStopCancellation,
  type MadangdManagedStopCompletion,
  type MadangdManagedStopContext,
  type MadangdManagedStopRequest
} from '../../../shared/madangd-stop-request'

const LOCK_RECORD_MAX_BYTES = 64 * 1024

export type MadangdManagedStopTarget =
  | { state: 'ready'; context: MadangdManagedStopContext }
  | { state: 'refused'; verdict: 'unverifiable'; code: string; reason: string }

function refused(code: string, reason: string): MadangdManagedStopTarget {
  return { state: 'refused', verdict: 'unverifiable', code, reason }
}

export async function readRemoteMadangdManagedStopTarget(
  options: MadangdSlotOptions,
  version: string
): Promise<MadangdManagedStopTarget> {
  const slotDir = madangdSlotDir(options, version)
  const readiness = parseMadangdReadinessWaitOutput(
    options.host,
    await execMadangdRemote(options, readMadangdReadinessNowCommand(options.host, slotDir))
  )
  if (readiness.state !== 'ready' || !readiness.readiness.health) {
    return refused(
      'madangd_managed_stop_readiness_unverifiable',
      `madangd ${version} has no readable readiness record, so the running instance is unknown.`
    )
  }
  const { health, runtimeId } = readiness.readiness
  if (health.stopRequests !== MADANGD_STOP_REQUESTS_CAPABILITY) {
    return refused(
      'madangd_managed_stop_unsupported',
      `madangd ${version} predates managed stop requests; it can only be stopped by signal.`
    )
  }
  const lockPath = joinRemotePath(options.host, options.userDataDir, MADANGD_LOCK_FILE_NAME)
  const lockRead = await readBoundedMadangdRemoteRecord(options, lockPath, LOCK_RECORD_MAX_BYTES)
  const lock = lockRead.state === 'present' ? parseMadangdInstanceLockRecord(lockRead.raw) : null
  if (!lock || lock.pid !== health.pid || !runtimeId) {
    return refused(
      'madangd_managed_stop_instance_unverifiable',
      `The instance lock does not name the madangd ${version} that published readiness.`
    )
  }
  return {
    state: 'ready',
    context: {
      version,
      runtimeId,
      instance: {
        pid: lock.pid,
        startedAtMs: lock.startedAtMs,
        // Newer slots use boot/start ticks to avoid wall-clock drift; older readers drop them.
        ...(lock.linuxStartTicks && lock.bootId
          ? { linuxStartTicks: lock.linuxStartTicks, bootId: lock.bootId }
          : {}),
        nonce: lock.nonce,
        lockPath
      }
    }
  }
}

export async function completeRemoteMadangdManagedStop(
  options: MadangdSlotOptions,
  request: MadangdManagedStopRequest
): Promise<MadangdManagedStopCompletion> {
  return MadangdManagedStopCompletionSchema.parse(
    await runSlotCommand(options, request, MADANGD_COMPLETE_MANAGED_STOP_FLAG)
  )
}

export async function cancelRemoteMadangdManagedStop(
  options: MadangdSlotOptions,
  request: MadangdManagedStopRequest
): Promise<MadangdManagedStopCancellation> {
  return MadangdManagedStopCancellationSchema.parse(
    await runSlotCommand(options, request, MADANGD_CANCEL_MANAGED_STOP_FLAG)
  )
}

// The slot's own build owns its stop-request format.
async function runSlotCommand(
  options: MadangdSlotOptions,
  request: MadangdManagedStopRequest,
  flag: string
): Promise<unknown> {
  const slotDir = madangdSlotDir(options, request.version)
  const entry = joinRemotePath(options.host, slotDir, 'madangd.js')
  const output = isWindowsRemoteHost(options.host)
    ? await runWindowsSlotCommand(options, slotDir, entry, request, flag)
    : await execMadangdRemote(
        options,
        `${selectMadangdSlotRuntimeCommand(options.host, slotDir, options.nodePath)} && ` +
          `"$madangd_runtime" ${quotePosixShell(entry)} ${flag} ${quotePosixShell(JSON.stringify(request))}`
      )
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.trim().startsWith('{'))
  if (!line) {
    throw new Error('madangd managed stop command returned no verifiable answer')
  }
  const parsed: unknown = JSON.parse(line)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('madangd managed stop command returned no verifiable answer')
  }
  if (!('transactionId' in parsed) || parsed.transactionId !== request.transactionId) {
    throw new Error('madangd managed stop command answered another transaction')
  }
  return parsed
}

// Stage JSON on Windows to avoid two command-line quoting layers.
async function runWindowsSlotCommand(
  options: MadangdSlotOptions,
  slotDir: string,
  entry: string,
  request: MadangdManagedStopRequest,
  flag: string
): Promise<string> {
  const runtime = readMadangdWindowsEncodedAnswer(
    await execMadangdRemote(
      options,
      madangdWindowsSlotOpCommand(options.host, slotDir, 'slot-runtime', [slotDir])
    ),
    MADANGD_WINDOWS_RUNTIME_MARKER
  )
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this madangd slot needs.')
  }
  const staged = joinRemotePath(options.host, slotDir, `.madangd-stop-command-${randomUUID()}.json`)
  let removeStaged = true
  try {
    await options.conn.writeFile(staged, JSON.stringify(request), {
      hostPlatform: options.host,
      signal: options.signal
    })
    return await execMadangdRemote(
      options,
      madangdWindowsNodeCommandLine(runtime, [
        entry,
        flag,
        MADANGD_MANAGED_STOP_REQUEST_FILE_FLAG,
        staged
      ])
    )
  } catch (error) {
    // Unconfirmed commands may still be reading the staged request.
    removeStaged = !isUnconfirmedSshCommandTermination(error)
    throw error
  } finally {
    if (removeStaged) {
      await execMadangdRemote(
        options,
        madangdWindowsSlotOpCommand(options.host, slotDir, 'remove-file', [staged])
      ).catch(() => {})
    }
  }
}
