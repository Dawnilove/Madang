/** C4 recovery uses bounded relaunch backoff, then census before publishing terminal verdicts. Background recovery requires confirmed-running distros and never boots them. */
import type { MadangdTerminalCensus } from '../../shared/madangd-terminal-census'
import type { WslRunningDistrosRead } from '../wsl-background-distro-gate'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import type { WslMadangdConnection, WslMadangdConnectOptions } from './wsl-madangd-connection'
import type { WslMadangdConnectionStatus } from './wsl-madangd-connection-status'
import type { WslLivenessVerdict } from './wsl-madangd-liveness-verdict'
import type { WslMadangdReconnectBackoff } from './wsl-madangd-reconnect-backoff'

export type WslMadangdRecoveryReason = 'madangd-exited' | 'distro-restarted' | 'distro-stopped'

export type WslMadangdRecoveryContext = {
  distro: string
  backoff: WslMadangdReconnectBackoff
  now: () => number
  /** False once the distro stopped being supervised or a newer recovery took over. */
  current: () => boolean
  wait: (delayMs: number) => Promise<void>
  publish: (status: WslMadangdConnectionStatus) => void
  ensure: (options: WslMadangdConnectOptions) => Promise<WslMadangdConnection>
  collectCensus: (connection: WslMadangdConnection) => Promise<MadangdTerminalCensus>
  /** Records the new madangd's identity and holds a fresh watch. */
  arm: (connection: WslMadangdConnection) => Promise<void>
  hasUserVisibleWork: () => boolean
  readRunning: () => Promise<WslRunningDistrosRead>
}

/** Ends ready, failed, or with the verdict the background gate found instead (returned). */
export async function recoverWslMadangd(
  context: WslMadangdRecoveryContext,
  reason: WslMadangdRecoveryReason
): Promise<WslLivenessVerdict | null> {
  const terminals = reason === 'madangd-exited' ? 'unverifiable' : 'exited'
  for (;;) {
    const decision = context.backoff.next(context.now())
    if (decision.kind === 'give-up') {
      context.publish({
        state: 'failed',
        reason: `Could not restart the Madang server in ${context.distro} after ${decision.attempts} attempts`,
        terminals
      })
      return null
    }
    const reconnecting = {
      state: 'reconnecting',
      reason,
      attempt: decision.attempt,
      terminals
    } as const
    context.publish({ ...reconnecting, retryInMs: decision.delayMs })
    await context.wait(decision.delayMs)
    if (!context.current()) {
      return null
    }
    if (!context.hasUserVisibleWork()) {
      const gate = backgroundRecoveryGate(await context.readRunning(), context.distro)
      if (gate || !context.current()) {
        return gate
      }
    }
    try {
      const connection = await context.ensure({
        status: {
          pending: { ...reconnecting, retryInMs: null },
          ready: { ...reconnecting, reason: 'census', retryInMs: null }
        }
      })
      if (!context.current()) {
        return null
      }
      // Recount before marking terminals; the daemon may have preserved all sessions across madangd loss.
      const census = await context.collectCensus(connection)
      await context.arm(connection)
      if (context.current()) {
        context.publish({ state: 'ready', census })
      }
      return null
    } catch (error) {
      console.warn(
        `[wsl] reconnect to ${context.distro} failed:`,
        error instanceof Error ? error.message : error
      )
      if (!context.current()) {
        return null
      }
    }
  }
}

/** null lets a background recovery go ahead: the distro is confirmed running. */
export function backgroundRecoveryGate(
  running: WslRunningDistrosRead,
  distro: string
): WslLivenessVerdict | null {
  if (running.status !== 'confirmed') {
    return { kind: 'unverifiable', reason: 'running-list-unavailable' }
  }
  const key = wslDistroHolderKey(distro)
  return running.distros.some((candidate) => wslDistroHolderKey(candidate) === key)
    ? null
    : { kind: 'distro-stopped', corroborated: false }
}
