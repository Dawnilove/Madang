// Reconcile interrupted transactions to the recorded slot and state; retain the fence whenever ownership remains unproven.
import type { ServeReadiness } from '../../server/serve-readiness'
import {
  planMadangdTransactionRecovery,
  type MadangdActivationTransaction
} from './madangd-activation-transaction'
import { readMadangdActivationTransaction } from './madangd-activation-transaction-store'
import {
  readMadangdActivationRecord,
  writeMadangdActivationRecord
} from './madangd-activation-record-store'
import {
  madangdActivationFenceExists,
  withStaleMadangdActivationRecoveryLock
} from './madangd-activation-lock'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'
import { ensureMadangdSlotServing, resolveMadangdSlotIdentity } from '../../ssh/madangd-recovery-slot'
import { reconcileMadangdDecommission } from '../lifecycle/madangd-decommission-recovery'
import {
  recoverMadangdIncumbent,
  type MadangdIncumbentRecoveryOptions
} from '../../ssh/madangd-incumbent-recovery'
import type { MadangdManagedRefusal } from '../../../shared/madangd-managed-runtime'
import { resumeInterruptedMadangdCandidate } from '../../ssh/madangd-interrupted-candidate-resume'
import { errorMessage } from '../../../shared/error-message'

export type MadangdActivationRecoveryResult =
  | { outcome: 'none' }
  | { outcome: 'pending'; code: string; reason: string }
  | {
      outcome: 'recovered'
      resolution: 'committed' | 'restored-incumbent'
      activeVersion: string | null
      readiness: ServeReadiness | null
    }
  | MadangdManagedRefusal

type MadangdActivationRecoveryOptions = MadangdIncumbentRecoveryOptions

export const MADANGD_RECOVERY_UNVERIFIABLE_CODE = 'madangd_recovery_unverifiable'

export async function recoverInterruptedMadangdActivation(
  options: MadangdActivationRecoveryOptions
): Promise<MadangdActivationRecoveryResult> {
  try {
    if (
      !(await readMadangdActivationTransaction(options)) &&
      !(await madangdActivationFenceExists(options))
    ) {
      return { outcome: 'none' }
    }
    return await withStaleMadangdActivationRecoveryLock(options, async (lock) => {
      const transaction = await readMadangdActivationTransaction(options)
      if (!transaction) {
        // Interrupted release can remove the journal before the fence; finishing release is enough.
        return { outcome: 'none' }
      }
      const result = await reconcileMadangdTransaction(options, transaction)
      if (result.outcome !== 'recovered') {
        lock.retain()
      }
      return result
    })
  } catch (error) {
    if (error instanceof RemoteInstallLockBusyError) {
      return {
        outcome: 'pending',
        code: 'madangd_recovery_transaction_still_fresh',
        reason:
          'The activation fence is held by a run that may still be working. Retry after the ' +
          'install lock recovery window.'
      }
    }
    return {
      outcome: 'refused',
      verdict: 'unverifiable',
      code: MADANGD_RECOVERY_UNVERIFIABLE_CODE,
      reason:
        `The interrupted activation could not be reconciled safely: ${errorMessage(error)} ` +
        'The host remains fenced.'
    }
  }
}

/** Requires a held fence; unverifiable steps throw to preserve it. */
async function reconcileMadangdTransaction(
  options: MadangdActivationRecoveryOptions,
  transaction: MadangdActivationTransaction
): Promise<MadangdActivationRecoveryResult> {
  const plan = planMadangdTransactionRecovery(transaction, await readMadangdActivationRecord(options))
  if (plan.action === 'refuse') {
    return { outcome: 'refused', verdict: 'unverifiable', code: plan.code, reason: plan.reason }
  }
  if (
    plan.action === 'confirm-decommissioned' ||
    plan.action === 'resume-stop' ||
    plan.action === 'keep-serving'
  ) {
    return reconcileMadangdDecommission(options, plan)
  }
  if (plan.action === 'finish-commit') {
    await writeMadangdActivationRecord(options, plan.record)
  }
  if (plan.action === 'stabilize-committed' || plan.action === 'finish-commit') {
    const activeVersion = plan.action === 'finish-commit' ? plan.record.active : plan.activeVersion
    if (!activeVersion) {
      throw new Error('The committed activation record has no active version.')
    }
    const identity = await resolveMadangdSlotIdentity(options, activeVersion)
    return {
      outcome: 'recovered',
      resolution: 'committed',
      activeVersion,
      readiness: await ensureMadangdSlotServing(options, identity)
    }
  }
  if (transaction.operation === 'activate' && plan.launchedVersion) {
    const readiness = await resumeInterruptedMadangdCandidate(options, transaction)
    if (readiness && 'outcome' in readiness) {
      return readiness
    }
    if (readiness) {
      return {
        outcome: 'recovered',
        resolution: 'committed',
        activeVersion: transaction.candidateVersion,
        readiness
      }
    }
  }
  const recovery = await recoverMadangdIncumbent(options, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: plan.launchedVersion,
    incumbent: plan.activeVersion
      ? await resolveMadangdSlotIdentity(options, plan.activeVersion)
      : null,
    restoreState: plan.restoreState,
    launchedFromState: plan.launchedFromState
  })
  return recovery.outcome === 'refused'
    ? recovery
    : {
        outcome: 'recovered',
        resolution: 'restored-incumbent',
        activeVersion: plan.activeVersion,
        readiness: recovery.readiness
      }
}
