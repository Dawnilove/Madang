/** Resume through the original readiness gate before undoing: the candidate may already serve changed state, and stopping it could require operator consent before anything can serve again. */
import type { ServeReadiness } from '../server/serve-readiness'
import { withActivatedVersion } from '../managed-server/activation/madangd-activation-record'
import { writeMadangdActivationRecord } from '../managed-server/activation/madangd-activation-record-store'
import type { MadangdActivateTransaction } from '../managed-server/activation/madangd-activation-transaction'
import { writeMadangdActivationTransaction } from '../managed-server/activation/madangd-activation-transaction-store'
import { withMadangdActivationCandidateReady } from '../managed-server/activation/madangd-activation-transaction-transitions'
import { MadangdActiveReadinessError } from './madangd-active-readiness'
import { madangdLivenessProvenExited } from '../managed-server/install/madangd-remote-launch'
import {
  MADANGD_RECOVERY_CHANGED_STATE_CODE,
  type MadangdManagedRefusal
} from '../../shared/madangd-managed-runtime'
import {
  ensureMadangdSlotServing,
  madangdSlotDir,
  resolveMadangdSlotIdentity,
  slotLiveness
} from './madangd-recovery-slot'
import type { MadangdIncumbentRecoveryOptions } from './madangd-incumbent-recovery'

/** Under the held fence, return null for undo; a refusal leaves the host untouched for an operator. */
export async function resumeInterruptedMadangdCandidate(
  options: MadangdIncumbentRecoveryOptions,
  transaction: MadangdActivateTransaction
): Promise<ServeReadiness | MadangdManagedRefusal | null> {
  const snapshotState = transaction.snapshot.state
  const incumbent = transaction.recordBefore.active
  if (
    transaction.phase !== 'snapshot-captured' ||
    snapshotState === 'pending' ||
    // A serving incumbent holds the port and instance lock; undo keeps it.
    (incumbent !== null &&
      !madangdLivenessProvenExited(await slotLiveness(options, madangdSlotDir(options, incumbent))))
  ) {
    return null
  }
  const candidate = await resolveMadangdSlotIdentity(options, transaction.candidateVersion)
  const candidateLiveness = await slotLiveness(options, candidate.remoteDir)
  // Old journals lack candidate app version, so commit would drop downgrade protection; undo a possibly serving candidate only with consent.
  if (transaction.candidateAppVersion === undefined) {
    if (madangdLivenessProvenExited(candidateLiveness) || options.acceptChangedState) {
      return null
    }
    if (candidateLiveness === 'UNKNOWN') {
      throw new Error(`Could not tell whether madangd ${transaction.candidateVersion} is running.`)
    }
    return {
      outcome: 'refused',
      verdict: 'live',
      code: MADANGD_RECOVERY_CHANGED_STATE_CODE,
      reason:
        `An older Madang left version ${transaction.candidateVersion} running without finishing ` +
        'its update, and did not record which app started it, so it was neither committed nor ' +
        'stopped. Recover to stop it, restore the prelaunch snapshot and restart the previous ' +
        'build; what it changed is discarded.'
    }
  }
  // Undo must rule out an unprovable candidate before starting another slot.
  if (candidateLiveness === 'UNKNOWN') {
    return null
  }
  let readiness: ServeReadiness
  try {
    readiness = await ensureMadangdSlotServing(options, candidate)
  } catch (error) {
    // Only candidate evidence permits undo; unanswered hosts retain the fence.
    if (error instanceof MadangdActiveReadinessError && error.verdict !== 'unverifiable') {
      return null
    }
    throw error
  }
  const now = new Date()
  const recordAfter = withActivatedVersion(
    transaction.recordBefore,
    transaction.candidateVersion,
    snapshotState === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: transaction.candidateVersion,
          readableByVersion: incumbent,
          takenAt: transaction.startedAt
        }
      : null,
    now,
    transaction.candidateAppVersion ?? undefined
  )
  await writeMadangdActivationTransaction(
    options,
    withMadangdActivationCandidateReady(transaction, recordAfter, now)
  )
  await writeMadangdActivationRecord(options, recordAfter)
  return readiness
}
