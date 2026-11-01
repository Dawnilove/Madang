import type { MadangdTerminalCensus } from '../../shared/madangd-terminal-census'
import type { SystemPowerLifecycleListener } from '../system-power-lifecycle'
import type { WslRunningDistrosRead } from '../wsl-background-distro-gate'
import type { WslGuestIdentity } from './wsl-guest-process-identity'
import type { WslMadangdConnection, WslMadangdConnectionManager } from './wsl-madangd-connection'
import type { WslMadangdConnectionStatus } from './wsl-madangd-connection-status'
import type { WslLivenessEvidence, WslLivenessTrigger } from './wsl-madangd-liveness-verdict'
import type { WslMadangdReconnectBackoff } from './wsl-madangd-reconnect-backoff'
import type { WslMadangdWatch } from './wsl-madangd-watch'

/** A ready connection with a held watch re-reads only the running list this often. */
export const WSL_MADANGD_HEARTBEAT_MS = 120_000

export type WslMadangdTimer = { cancel(): void }

export type WslMadangdLivenessDependencies = {
  manager: Pick<WslMadangdConnectionManager, 'ensure' | 'get' | 'publish' | 'close'>
  readRunning: () => Promise<WslRunningDistrosRead>
  readIdentity: (distro: string, madangdPid: number | null) => Promise<WslGuestIdentity | null>
  openWatch: (connection: WslMadangdConnection) => Promise<WslMadangdWatch>
  collectCensus: (connection: WslMadangdConnection) => Promise<MadangdTerminalCensus>
  /** A WSL project or terminal the user can see is open on this distro. */
  hasUserVisibleWork: (distro: string) => boolean
  deferUntilRunning: (distro: string, key: string, task: () => unknown) => void
  /** C3's `ensureHeld`; called only while the distro is confirmed running, so it never boots. */
  ensureHolder?: (distro: string) => Promise<unknown>
  subscribePower?: (listener: SystemPowerLifecycleListener) => () => void
  monotonicNow?: () => number
  schedule?: (delayMs: number, task: () => void) => WslMadangdTimer
  random?: () => number
  heartbeatMs?: number
}

export type Trigger = WslLivenessTrigger | 'heartbeat'

export type Supervised = {
  distro: string
  key: string
  generation: number
  expected: WslLivenessEvidence['expected']
  watch: WslMadangdWatch | null
  timer: WslMadangdTimer | null
  /** Ends a recovery's backoff wait early once the distro stops being supervised. */
  wakeWait: (() => void) | null
  backoff: WslMadangdReconnectBackoff
  verifyStreak: number
  busy: boolean
  pending: Trigger | null
  state: WslMadangdConnectionStatus['state'] | null
  lastBeatMs: number
}

export function newSupervised(
  distro: string,
  key: string,
  nowMs: number,
  backoff: WslMadangdReconnectBackoff
): Supervised {
  return {
    distro: distro.trim(),
    key,
    generation: 0,
    expected: { distroInstance: null, madangd: null },
    watch: null,
    timer: null,
    wakeWait: null,
    backoff,
    verifyStreak: 0,
    busy: false,
    pending: null,
    state: null,
    lastBeatMs: nowMs
  }
}

/** Cancels the entry's timer and wake wait and closes its watch. */
export function disarmSupervised(entry: Supervised): void {
  entry.timer?.cancel()
  entry.timer = null
  entry.wakeWait?.()
  entry.wakeWait = null
  entry.watch?.close()
  entry.watch = null
}
