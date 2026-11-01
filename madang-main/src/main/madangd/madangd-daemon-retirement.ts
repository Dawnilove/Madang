// Daemons outlive madangd; retire only after their atomic cross-generation census proves no live sessions.
// Busy/unresponsive daemons stay up, and madangd shutdown does not wait indefinitely.
import {
  listLiveDaemonSessions,
  releaseDaemonRetirementFence,
  requestIdleDaemonRetirement
} from '../daemon/daemon-provider-state'
import type { DaemonIdleRetirementResult } from '../daemon/daemon-pty-runtime-state'
import type { MadangdDaemonRetirementVerdict } from '../../shared/madangd-stop-request'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import { MADANGD_DAEMON_RETIREMENT_TIMEOUT_MS } from './madangd-stop-deadlines'

export type MadangdDaemonRetirement = {
  retirement: MadangdDaemonRetirementVerdict
  liveSessions: number | null
  reason: string | null
  /** Whether timed-out work eventually retired the daemon. */
  lateRetirement?: Promise<boolean>
}

export async function countLiveMadangdDaemonSessions(): Promise<number | null> {
  try {
    return (await listLiveDaemonSessions())?.length ?? null
  } catch {
    return null
  }
}

type RetirementPorts = {
  request: typeof requestIdleDaemonRetirement
  releaseFence: typeof releaseDaemonRetirementFence
  countLiveSessions: typeof countLiveMadangdDaemonSessions
  timeoutMs: number
}

const DEFAULT_PORTS: RetirementPorts = {
  request: requestIdleDaemonRetirement,
  releaseFence: releaseDaemonRetirementFence,
  countLiveSessions: countLiveMadangdDaemonSessions,
  timeoutMs: MADANGD_DAEMON_RETIREMENT_TIMEOUT_MS
}

export async function retireMadangdDaemonIfIdle(
  ports: Partial<RetirementPorts> = {}
): Promise<MadangdDaemonRetirement> {
  const { request, releaseFence, countLiveSessions, timeoutMs } = { ...DEFAULT_PORTS, ...ports }
  const attempt = request().catch(() => ({ state: 'unverifiable' as const }))
  const result = await withTimeout<DaemonIdleRetirementResult | { state: 'timed-out' }>(
    attempt,
    timeoutMs,
    { state: 'timed-out' }
  )
  // Keep admission fenced while retirement is pending; reopen only after a definitive late refusal.
  const lateRetirement =
    result.state === 'timed-out'
      ? attempt.then((late) => {
          if (late.state !== 'retiring') {
            releaseFence()
          }
          return late.state === 'retiring'
        })
      : undefined
  if (result.state === 'retiring') {
    return { retirement: 'retired', liveSessions: 0, reason: null }
  }
  // Surviving daemons must resume terminal admission.
  releaseFence()
  const liveSessions =
    result.state === 'busy' && result.liveSessions !== null
      ? result.liveSessions
      : await withTimeout(countLiveSessions(), timeoutMs, null)
  if (liveSessions !== null && liveSessions > 0) {
    return {
      retirement: 'live',
      liveSessions,
      reason:
        `${liveSessions} terminal ${liveSessions === 1 ? 'session is' : 'sessions are'} still ` +
        'live, so the daemon stays up and keeps them.'
    }
  }
  return {
    retirement: 'unverifiable',
    liveSessions,
    ...(lateRetirement ? { lateRetirement } : {}),
    reason:
      result.state === 'unsupported'
        ? 'The terminal daemon predates idle retirement, so it was left running.'
        : 'The host could not prove the daemon idle, so it was left running.'
  }
}
