// Rollback restores a pre-activation snapshot: older builds may not understand newer state.
// Stop, rescue, restore, then launch; the rescue and fenced journal allow recovery of interrupted steps.
import { logMadangdActivationOutcome } from '../activation/madangd-activation-outcome-log'
import type { MadangdHostTransport } from '../../ssh/madangd-host-transport'
import type { MadangdActivationRecord } from '../activation/madangd-activation-record'
import type { MadangdTerminalCensus } from '../../../shared/madangd-terminal-census'
import type { MadangdActivationVerdict } from '../activation/madangd-activation-gate'
import type { MadangdDaemonProtocolFacts } from '../../ssh/madangd-daemon-protocol-crossing'
import { readMadangdActivationRecord } from '../activation/madangd-activation-record-store'
import { sameMadangdActivationRecord } from '../activation/madangd-activation-transaction'
import type { RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  resolveMadangdActivationReadinessTimeout,
  withMadangdActivationLock
} from '../activation/madangd-activation-lock'
import { madangdActivationFenceRefusal } from '../activation/madangd-activation-fence-hold'
import { MADANGD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/madangd-profile-preflight'
import { rollbackMadangdLocked } from '../lifecycle/madangd-rollback-transition'

export type MadangdRollbackOptions = {
  conn: MadangdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  record: MadangdActivationRecord
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  census: MadangdTerminalCensus
  /** Close terminal admission, then recount under the host lock; any failure is unverifiable. */
  recountCensus: () => Promise<MadangdTerminalCensus>
  /** Reopen admission if rollback leaves the incumbent serving. */
  releaseIncumbentAdmission: () => Promise<void>
  /** Expected hash from the client's copy of the rollback target. */
  targetBuildHash: string
  /** Protocol facts from the same target bytes. */
  targetDaemonProtocol: MadangdDaemonProtocolFacts
  readinessTimeoutMs?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type MadangdRollbackResult =
  | { outcome: 'rolled-back'; target: string; discarded: string[]; verdict: MadangdActivationVerdict }
  | { outcome: 'refused'; code: string; reason: string }
  | { outcome: 'failed'; code: string; reason: string }

export async function rollbackMadangd(input: MadangdRollbackOptions): Promise<MadangdRollbackResult> {
  const options = {
    ...input,
    readinessTimeoutMs: resolveMadangdActivationReadinessTimeout(
      input.readinessTimeoutMs,
      MADANGD_STARTUP_READINESS_TIMEOUT_MS
    )
  }
  return logMadangdActivationOutcome(
    `rollback to ${options.record.previous ?? 'none'}`,
    () =>
      withMadangdActivationLock(
        options,
        async (lock) => {
          if (
            !sameMadangdActivationRecord(await readMadangdActivationRecord(options), options.record)
          ) {
            return {
              outcome: 'refused',
              code: 'madangd_rollback_record_changed',
              reason:
                'The host activation record changed while this rollback was waiting. Refresh the ' +
                'host state and review the new rollback target before trying again.'
            }
          }
          return rollbackMadangdLocked(options, lock)
        },
        async () => {
          const { code, reason } = await madangdActivationFenceRefusal(options, 'rollback')
          return { outcome: 'refused', code, reason }
        }
      ),
    ['rolled-back']
  )
}
