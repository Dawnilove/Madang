import type { MadangdActivationLockControl } from '../managed-server/activation/madangd-activation-lock'
import type { MadangdSnapshotVerdict } from '../managed-server/activation/madangd-activation-transaction'
import { madangdStopFreedTheHost } from '../managed-server/install/madangd-remote-process-control'
import { withoutAbortSignal } from '../managed-server/install/madangd-remote-runtime-control'
import {
  launchMadangdSlot,
  stopMadangdSlot,
  MADANGD_SLOT_STOP_WAIT_SECONDS,
  type MadangdSlotIdentity,
  type MadangdSlotOptions
} from './madangd-recovery-slot'
import { recoverMadangdIncumbent } from './madangd-incumbent-recovery'
import { errorMessage } from '../../shared/error-message'

/** Return null on proven exit; otherwise retain the fence when a delivered stop may still change the host. */
export async function stopTransactionIncumbent(
  options: MadangdSlotOptions,
  incumbent: MadangdSlotIdentity,
  lock: MadangdActivationLockControl
): Promise<{ reason: string; stopMayBeUnderway: boolean } | null> {
  const stopped = await stopMadangdSlot(options, incumbent.remoteDir, false)
  if (madangdStopFreedTheHost(stopped)) {
    return null
  }
  // Only a stop that may have been delivered can still change the host; otherwise nothing happened.
  const stopMayBeUnderway = stopped === 'still-running' || stopped === 'unconfirmed'
  if (stopMayBeUnderway) {
    lock.retain()
  }
  return {
    reason:
      `Could not verify that madangd ${incumbent.version} exited within ` +
      `${MADANGD_SLOT_STOP_WAIT_SECONDS}s (${stopped}).`,
    stopMayBeUnderway
  }
}

export async function restartAfterSnapshotFailure(
  options: MadangdSlotOptions,
  incumbent: MadangdSlotIdentity,
  lock: MadangdActivationLockControl
): Promise<string> {
  try {
    await launchMadangdSlot(withoutAbortSignal(options), incumbent)
    lock.recovered()
    return `madangd ${incumbent.version} was restarted and is serving again.`
  } catch (error) {
    lock.retain()
    return `restarting madangd ${incumbent.version} failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Restore changed state and incumbent only after both slots prove exit; refusal retains the fence. */
export async function putTransactionIncumbentBack(
  options: MadangdSlotOptions,
  lock: MadangdActivationLockControl,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: MadangdSlotIdentity | null
    restoreState: MadangdSnapshotVerdict | null
    launchedFromState?: MadangdSnapshotVerdict | null
  }
): Promise<string | null> {
  try {
    const recovery = await recoverMadangdIncumbent(withoutAbortSignal(options), {
      ...input,
      slotsProvenExited: true
    })
    if (recovery.outcome === 'refused') {
      lock.retain()
      return recovery.reason
    }
    lock.recovered()
    return null
  } catch (error) {
    lock.retain()
    return `Restoring the previous version failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Stop the rejected candidate before safely restoring incumbent state. */
export async function restoreAfterRejectedCandidate(
  options: MadangdSlotOptions,
  lock: MadangdActivationLockControl,
  input: {
    launchedDir: string
    launchedVersion: string
    transactionStartedAt: string
    incumbent: MadangdSlotIdentity | null
    restoreState: MadangdSnapshotVerdict | null
    launchedFromState?: MadangdSnapshotVerdict | null
  }
): Promise<string> {
  const { launchedDir, ...restore } = input
  const stopped = await stopMadangdSlot(withoutAbortSignal(options), launchedDir, true).catch(
    (error: unknown) => `unverifiable: ${errorMessage(error)}`
  )
  if (stopped !== 'stopped' && stopped !== 'already-exited') {
    lock.retain()
    return (
      `madangd ${input.launchedVersion} could not be confirmed stopped (${stopped}), so nothing ` +
      'was restored over state it may still own. This host requires recovery.'
    )
  }
  const failure = await putTransactionIncumbentBack(options, lock, restore)
  return (
    failure ??
    (input.incumbent
      ? `madangd ${input.incumbent.version} was restarted and is serving again.`
      : 'No previous version was active, so this host is now serving nothing.')
  )
}
