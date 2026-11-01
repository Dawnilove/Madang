import { madangdRemoteBaseDir } from '../install/madangd-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { MadangdRollbackOptions, MadangdRollbackResult } from '../install/madangd-remote-rollback'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { withRolledBackVersion } from '../activation/madangd-activation-record'
import { writeMadangdActivationRecord } from '../activation/madangd-activation-record-store'
import { launchAndJudgeMadangdSlot } from '../../ssh/madangd-candidate-launch-verdict'
import { assessMadangdRollback } from '../../ssh/madangd-update-plan'
import { MADANGD_LOG_FILENAME } from '../install/madangd-remote-host-support'
import {
  captureMadangdStateSnapshotCommand,
  madangdRollbackRescueDirName,
  parseMadangdSnapshotCapture,
  parseMadangdSnapshotPresence,
  parseMadangdSnapshotRestore,
  probeMadangdStateSnapshotCommand,
  restoreMadangdStateSnapshotCommand
} from '../host-state/madangd-state-snapshot'
import {
  newestStateMtimeCommand,
  parseNewestStateMtimeSeconds
} from '../host-state/madangd-state-newest-mtime'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'
import type { MadangdActivationLockControl } from '../activation/madangd-activation-lock'
import {
  rollbackStartingState,
  type MadangdRollbackTransaction
} from '../activation/madangd-activation-transaction'
import {
  createMadangdRollbackTransaction,
  withMadangdRollbackPhase,
  withMadangdRollbackRescue
} from '../activation/madangd-activation-transaction-transitions'
import { writeMadangdActivationTransaction } from '../activation/madangd-activation-transaction-store'
import { ROLLBACK_STALE_COUNT, rollbackRecountRefusal } from './madangd-rollback-admission'
import { runFencedStop } from '../../ssh/madangd-fenced-stop'
import { execMadangdRemoteOr, withoutAbortSignal } from '../install/madangd-remote-runtime-control'
import { execMadangdStateMutationOr } from '../host-state/madangd-state-mutation-exec'
import {
  madangdSlotDir,
  resolveMadangdSlotIdentity,
  type MadangdSlotIdentity
} from '../../ssh/madangd-recovery-slot'
import { madangdSnapshotPath } from '../../ssh/madangd-incumbent-recovery'
import {
  putTransactionIncumbentBack,
  restoreAfterRejectedCandidate
} from '../../ssh/madangd-transaction-incumbent'
import {
  readMadangdRollbackBarrierTarget,
  rollbackBarrierRefusal,
  stopIncumbentBehindTerminalBarrier
} from './madangd-rollback-terminal-barrier'
import { withMadangdLogTail } from '../install/madangd-remote-log-tail'
import { errorMessage } from '../../../shared/error-message'

async function stateWritesSinceActivation(options: MadangdRollbackOptions): Promise<boolean | null> {
  const activatedAtSeconds = Math.floor(Date.parse(options.record.activatedAt ?? '') / 1000)
  if (!Number.isFinite(activatedAtSeconds)) {
    return null
  }
  const newest = parseNewestStateMtimeSeconds(
    await execMadangdRemoteOr(
      options,
      newestStateMtimeCommand(
        options.host,
        options.userDataDir,
        madangdRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  return newest === null ? null : newest >= activatedAtSeconds
}

export async function rollbackMadangdLocked(
  options: MadangdRollbackOptions,
  lock: MadangdActivationLockControl
): Promise<MadangdRollbackResult> {
  const now = options.now ?? ((): Date => new Date())
  const snapshot = options.record.snapshot
  const presence = snapshot
    ? parseMadangdSnapshotPresence(
        await execMadangdRemoteOr(
          options,
          probeMadangdStateSnapshotCommand(
            options.host,
            madangdSnapshotPath(options, snapshot.dirName),
            madangdRemoteBaseDir(options.host, options.remoteHome)
          )
        )
      )
    : 'absent'
  const safety = assessMadangdRollback({
    record: options.record,
    snapshotPresent: presence === 'unverifiable' ? null : presence === 'present',
    census: options.census,
    targetDaemonProtocol: options.targetDaemonProtocol,
    stateWritesSinceActivation: await stateWritesSinceActivation(options)
  })
  if (safety.safety === 'unsafe') {
    return { outcome: 'refused', code: safety.code, reason: safety.reason }
  }
  if (!snapshot || !options.record.active) {
    return {
      outcome: 'refused',
      code: 'madangd_rollback_no_active',
      reason: 'No madangd version is active on this host, so there is nothing to roll back from.'
    }
  }
  let incumbent: MadangdSlotIdentity
  try {
    incumbent = await resolveMadangdSlotIdentity(options, options.record.active)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return {
      outcome: 'refused',
      code: 'madangd_rollback_active_identity_unverifiable',
      reason: `The active madangd identity could not be verified: ${errorMessage(error)} Nothing was changed.`
    }
  }

  const barrierTarget = await readMadangdRollbackBarrierTarget(options, incumbent.version)
  if (barrierTarget.state === 'refused') {
    return { outcome: 'refused', code: barrierTarget.code, reason: barrierTarget.reason }
  }
  const startedAt = now()
  let transaction: MadangdRollbackTransaction = createMadangdRollbackTransaction({
    transactionId: randomUUID(),
    incumbentVersion: incumbent.version,
    targetVersion: safety.target,
    recordBefore: options.record,
    recordAfter: withRolledBackVersion(options.record, startedAt),
    rescueDirName: madangdRollbackRescueDirName(incumbent.version, startedAt.getTime()),
    now: startedAt
  })
  const fenced = await runFencedStop({
    recountCensus: options.recountCensus,
    releaseIncumbentAdmission: options.releaseIncumbentAdmission,
    now: () => now().getTime(),
    refuse: rollbackRecountRefusal,
    prepare: () => writeMadangdActivationTransaction(options, transaction),
    stale: () => ROLLBACK_STALE_COUNT,
    stop: async () => {
      lock.retainOnError()
      // Cancellation after mutation could strand a stopped host; finish or recover instead.
      options = withoutAbortSignal(options)
      // Pre-lock census can go stale; the fenced stop supplies the terminal-safety proof.
      return stopIncumbentBehindTerminalBarrier(
        options,
        transaction.transactionId,
        barrierTarget.context
      )
    },
    // Withdrawn stops leave the incumbent serving and needing admission reopened.
    stopMayHaveBeenSent: (barrier) => barrier.state !== 'withdrawn'
  })
  if ('refused' in fenced) {
    return fenced.refused
  }
  const blocked = rollbackBarrierRefusal(fenced.stopped)
  if (blocked) {
    if (blocked.retainFence) {
      lock.retain()
    }
    const recovered = blocked.restartIncumbent
      ? ` ${await putIncumbentBack(options, lock, transaction, incumbent)}`
      : ''
    return { outcome: blocked.outcome, code: blocked.code, reason: blocked.reason + recovered }
  }
  transaction = withMadangdRollbackPhase(transaction, 'incumbent-stopped', now())
  await writeMadangdActivationTransaction(options, transaction)

  const rescue = parseMadangdSnapshotCapture(
    await execMadangdStateMutationOr(
      options,
      captureMadangdStateSnapshotCommand(
        options.host,
        options.userDataDir,
        madangdSnapshotPath(options, transaction.rescue.dirName),
        madangdRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (rescue === 'failed') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'madangd_rollback_rescue_snapshot_failed',
      reason:
        'The current state could not be preserved in a rescue snapshot, so the data root was ' +
        `not replaced. ${recovered}`
    }
  }
  transaction = withMadangdRollbackRescue(transaction, rescue, now())
  await writeMadangdActivationTransaction(options, transaction)

  // Restore before launching: older builds must never load newer state.
  const restored = parseMadangdSnapshotRestore(
    await execMadangdStateMutationOr(
      options,
      restoreMadangdStateSnapshotCommand(
        options.host,
        options.userDataDir,
        madangdSnapshotPath(options, snapshot.dirName),
        madangdRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (restored !== 'restored') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'madangd_rollback_restore_failed',
      reason: `The pre-activation snapshot could not be restored (${restored}). ${recovered}`
    }
  }
  transaction = withMadangdRollbackPhase(transaction, 'rollback-state-restored', now())
  await writeMadangdActivationTransaction(options, transaction)

  const targetDir = madangdSlotDir(options, safety.target)
  const { verdict, launchError } = await launchAndJudgeMadangdSlot(options, {
    remoteInstallDir: targetDir,
    fullVersion: safety.target,
    buildHash: options.targetBuildHash
  })
  if (verdict.decision === 'reject') {
    const reason =
      launchError === undefined
        ? verdict.reason
        : `It failed while starting: ${errorMessage(launchError)}`
    const recovered = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: targetDir,
      launchedVersion: safety.target,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: rescueVerdict(transaction),
      launchedFromState: rollbackStartingState(transaction)
    })
    return {
      outcome: 'failed',
      code: launchError === undefined ? verdict.code : 'madangd_rollback_target_launch_failed',
      reason: await withMadangdLogTail(
        options,
        targetDir,
        `The rollback target ${safety.target} did not come up healthy: ${reason} ${recovered} ` +
          `Its stderr is at ${joinRemotePath(options.host, targetDir, MADANGD_LOG_FILENAME)}.`
      )
    }
  }

  // Until target readiness is proven, active must still identify the recoverable incumbent.
  transaction = withMadangdRollbackPhase(transaction, 'target-ready', now())
  await writeMadangdActivationTransaction(options, transaction)
  await writeMadangdActivationRecord(options, transaction.recordAfter)
  return {
    outcome: 'rolled-back',
    target: safety.target,
    discarded: safety.safety === 'lossy' ? safety.discards : [],
    verdict
  }
}

type RestoreState = Parameters<typeof putTransactionIncumbentBack>[2]['restoreState']

function rescueVerdict(transaction: MadangdRollbackTransaction): RestoreState {
  return transaction.rescue.state === 'pending' ? null : transaction.rescue
}

async function putIncumbentBack(
  options: MadangdRollbackOptions,
  lock: MadangdActivationLockControl,
  transaction: MadangdRollbackTransaction,
  incumbent: MadangdSlotIdentity
): Promise<string> {
  const failure = await putTransactionIncumbentBack(options, lock, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: null,
    incumbent,
    restoreState: rescueVerdict(transaction)
  })
  return failure ?? `madangd ${incumbent.version} was restored and is serving again.`
}
