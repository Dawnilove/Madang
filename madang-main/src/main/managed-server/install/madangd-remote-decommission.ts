// Journal instance-bound stop under the activation fence; refuse live/unknown terminal census and deactivate only after proven exit.
import { randomUUID } from 'node:crypto'
import type { MadangdActivationRecord } from '../activation/madangd-activation-record'
import {
  readMadangdActivationRecord,
  writeMadangdActivationRecord
} from '../activation/madangd-activation-record-store'
import { sameMadangdActivationRecord } from '../activation/madangd-activation-transaction'
import { writeMadangdActivationTransaction } from '../activation/madangd-activation-transaction-store'
import { withMadangdActivationLock } from '../activation/madangd-activation-lock'
import { madangdActivationFenceRefusal } from '../activation/madangd-activation-fence-hold'
import {
  committedMadangdDecommissionRecord,
  createMadangdDecommissionTransaction,
  withMadangdDecommissionProcessExited,
  withMadangdDecommissionStopDispatched
} from '../lifecycle/madangd-decommission-transaction'
import { readRemoteMadangdManagedStopTarget } from '../lifecycle/madangd-managed-remote-stop'
import { settleMadangdDecommissionStop } from '../lifecycle/madangd-decommission-stop'
import type { MadangdSlotOptions } from '../../ssh/madangd-recovery-slot'
import type { MadangdDecommissionResult } from '../../../shared/madangd-decommission'
import type { MadangdTerminalCensus } from '../../../shared/madangd-terminal-census'

type MadangdDecommissionOptions = MadangdSlotOptions & {
  /** Refuse if the host record changed since caller review. */
  record: MadangdActivationRecord
  /** Fresh census must prove no live or uncounted terminals. */
  census: MadangdTerminalCensus
  now?: () => Date
}

type Refusal = Extract<MadangdDecommissionResult, { outcome: 'refused' }>

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

function censusRefusal(census: MadangdTerminalCensus): Refusal | null {
  if (census.liveSessions === null) {
    return refuse(
      'unverifiable',
      'madangd_decommission_census_unavailable',
      'The terminal daemon did not answer a session count, so decommissioning could end ' +
        'running work. Retry when the host answers.'
    )
  }
  if (census.liveSessions > 0) {
    return refuse(
      'live',
      'madangd_decommission_terminals_running',
      `${census.liveSessions} terminal${census.liveSessions === 1 ? ' is' : 's are'} still ` +
        'running on this host. Close them before decommissioning the server.'
    )
  }
  return null
}

export async function decommissionRemoteMadangd(
  options: MadangdDecommissionOptions
): Promise<MadangdDecommissionResult> {
  const now = options.now ?? ((): Date => new Date())
  return withMadangdActivationLock(
    options,
    async (lock) => {
      const record = await readMadangdActivationRecord(options)
      if (!sameMadangdActivationRecord(record, options.record)) {
        return refuse(
          'unverifiable',
          'madangd_decommission_record_changed',
          'The host activation record changed since it was reviewed. Refresh and try again.'
        )
      }
      const activeVersion = record.active
      if (!activeVersion) {
        return refuse(
          'unverifiable',
          'madangd_decommission_nothing_active',
          'No madangd version is active on this host, so there is nothing to decommission.'
        )
      }
      const census = censusRefusal(options.census)
      if (census) {
        return census
      }
      const target = await readRemoteMadangdManagedStopTarget(options, activeVersion)
      if (target.state === 'refused') {
        return refuse(target.verdict, target.code, target.reason)
      }

      let transaction = createMadangdDecommissionTransaction({
        transactionId: randomUUID(),
        recordBefore: { ...record, active: activeVersion },
        now: now()
      })
      await writeMadangdActivationTransaction(options, transaction)
      lock.retainOnError()
      const request = {
        schemaVersion: 1 as const,
        transactionId: transaction.transactionId,
        ...target.context,
        // Idle daemon retirement is best-effort; busy daemons retain their terminals.
        retireIdleDaemon: true as const
      }
      // Journal exact stop intent before dispatch so recovery can settle the same request.
      transaction = withMadangdDecommissionStopDispatched(transaction, request, now())
      await writeMadangdActivationTransaction(options, transaction)

      const settlement = await settleMadangdDecommissionStop(options, request)
      if (settlement.state === 'withdrawn') {
        return refuse(settlement.verdict, 'madangd_decommission_stop_withdrawn', settlement.reason)
      }
      if (settlement.state === 'unsettled') {
        lock.retain()
        return refuse(settlement.verdict, 'madangd_decommission_stop_unsettled', settlement.reason)
      }
      transaction = withMadangdDecommissionProcessExited(transaction, now())
      await writeMadangdActivationTransaction(options, transaction)
      await writeMadangdActivationRecord(options, committedMadangdDecommissionRecord(transaction))
      return {
        outcome: 'decommissioned',
        version: activeVersion,
        retirement: settlement.retirement
      }
    },
    async () => {
      const refusal = await madangdActivationFenceRefusal(options, 'stop')
      return refuse('unverifiable', refusal.code, refusal.reason)
    }
  )
}
