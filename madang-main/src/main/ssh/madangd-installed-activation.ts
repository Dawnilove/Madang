/** Journal durably before mutation so interrupted deploys can finish or recover. Release the fence only once the host is provably settled on one slot. */
import { madangdRemoteBaseDir } from '../managed-server/install/madangd-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { MadangdDeployOptions, MadangdDeployResult } from './madangd-remote-deploy'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import {
  withActivatedVersion,
  type MadangdActivationRecord,
  type MadangdStateSnapshot
} from '../managed-server/activation/madangd-activation-record'
import {
  readMadangdActivationRecord,
  writeMadangdActivationRecord
} from '../managed-server/activation/madangd-activation-record-store'
import { launchAndJudgeMadangdSlot } from './madangd-candidate-launch-verdict'
import { planMadangdUpdate } from './madangd-update-plan'
import {
  type MadangdTerminalCensus,
  UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
} from '../../shared/madangd-terminal-census'
import { runFencedStop } from './madangd-fenced-stop'
import { CURRENT_MADANGD_DAEMON_PROTOCOL } from './madangd-daemon-protocol-crossing'
import { MADANGD_LOG_FILENAME } from '../managed-server/install/madangd-remote-host-support'
import { madangdSnapshotFailureReason } from '../managed-server/host-state/madangd-state-snapshot-space'
import {
  MADANGD_SNAPSHOT_SPACE_INSUFFICIENT_CODE,
  madangdSnapshotRoomRefusal,
  madangdSnapshotsRoot
} from './madangd-snapshot-room'
import {
  captureMadangdStateSnapshotCommand,
  madangdSnapshotDirName,
  parseMadangdSnapshotCapture
} from '../managed-server/host-state/madangd-state-snapshot'
import { joinRemotePath } from './ssh-remote-platform'
import { computeLocalMadangdBuildHash } from './madangd-local-build-hash'
import { preflightInstalledMadangd } from '../managed-server/install/madangd-remote-preflight'
import type { MadangdActivationLockControl } from '../managed-server/activation/madangd-activation-lock'
import type { MadangdActivateTransaction } from '../managed-server/activation/madangd-activation-transaction'
import {
  createMadangdActivationTransaction,
  withMadangdActivationCandidateReady,
  withMadangdActivationIncumbentStopped,
  withMadangdActivationSnapshot
} from '../managed-server/activation/madangd-activation-transaction-transitions'
import { writeMadangdActivationTransaction } from '../managed-server/activation/madangd-activation-transaction-store'
import {
  execMadangdRemoteOr,
  withoutAbortSignal
} from '../managed-server/install/madangd-remote-runtime-control'
import { execMadangdStateMutationOr } from '../managed-server/host-state/madangd-state-mutation-exec'
import {
  initialMadangdActivationAdmissionCommand,
  parseInitialMadangdActivationAdmission
} from './madangd-initial-activation-admission'
import {
  madangdSlotDir,
  resolveMadangdSlotIdentity,
  type MadangdSlotIdentity
} from './madangd-recovery-slot'
import { madangdSnapshotPath } from './madangd-incumbent-recovery'
import {
  restartAfterSnapshotFailure,
  restoreAfterRejectedCandidate,
  stopTransactionIncumbent
} from './madangd-transaction-incumbent'
import { withMadangdLogTail } from '../managed-server/install/madangd-remote-log-tail'
import { madangdCandidateLaunchFailureCode } from '../madangd/madangd-host-unavailable'
import { errorMessage } from '../../shared/error-message'

type Outcome = Extract<MadangdDeployResult, { outcome: 'installed-not-activated' }>

export const MADANGD_ACTIVATION_POLICY_REFUSED_CODE = 'madangd_activation_policy_refused'

function countedLockedRecord(options: MadangdDeployOptions, record: MadangdActivationRecord): boolean {
  const counted = options.censusRecord
  return (
    !counted || (counted.active === record.active && counted.activatedAt === record.activatedAt)
  )
}

/** A census of another incumbent cannot authorize stopping this one. */
function censusForLockedRecord(
  options: MadangdDeployOptions,
  record: MadangdActivationRecord
): MadangdTerminalCensus {
  return countedLockedRecord(options, record) ? options.census : UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
}

export async function activateInstalledMadangd(
  options: MadangdDeployOptions & { localMadangdDir: string },
  fullVersion: string,
  remoteDir: string,
  lock: MadangdActivationLockControl
): Promise<MadangdDeployResult> {
  const now = options.now ?? ((): Date => new Date())
  const notActivated = (code: string, reason: string): Outcome => ({
    outcome: 'installed-not-activated',
    fullVersion,
    code,
    reason
  })
  const record = await readMadangdActivationRecord(options)
  const plan = planMadangdUpdate({
    record,
    candidateVersion: fullVersion,
    census: censusForLockedRecord(options, record),
    candidateDaemonProtocol: CURRENT_MADANGD_DAEMON_PROTOCOL,
    ...(options.force !== undefined ? { force: options.force } : {})
  })
  if (plan.action === 'noop') {
    return { outcome: 'already-active', fullVersion }
  }
  const refusal = options.admitRecord?.(record, fullVersion)
  if (refusal) {
    return notActivated(MADANGD_ACTIVATION_POLICY_REFUSED_CODE, refusal)
  }
  if (plan.action === 'defer') {
    return notActivated(plan.code, plan.reason)
  }

  try {
    await preflightInstalledMadangd({
      ...options,
      remoteInstallDir: remoteDir,
      fullVersion
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    return notActivated(
      'madangd_candidate_preflight_failed',
      `Candidate profile preflight failed; the incumbent was not stopped: ${errorMessage(error)}`
    )
  }

  let incumbent: MadangdSlotIdentity | null = null
  if (record.active) {
    try {
      incumbent = await resolveMadangdSlotIdentity(options, record.active)
    } catch (error) {
      if (isUnconfirmedSshCommandTermination(error)) {
        throw error
      }
      return notActivated(
        'madangd_incumbent_identity_unverifiable',
        `The active madangd ${record.active} build identity could not be verified before ` +
          `stopping it: ${errorMessage(error)} Nothing was stopped.`
      )
    }
  } else {
    const admission = parseInitialMadangdActivationAdmission(
      await execMadangdRemoteOr(
        options,
        initialMadangdActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    if (admission.decision === 'defer') {
      return notActivated(admission.code, admission.reason)
    }
  }

  // Scan snapshot room before recount so slow scans cannot outdate stop admission.
  const roomless = await madangdSnapshotRoomRefusal(options, record, fullVersion)
  if (roomless) {
    return notActivated(MADANGD_SNAPSHOT_SPACE_INSUFFICIENT_CODE, roomless)
  }

  const startedAt = now()
  let transaction: MadangdActivateTransaction = createMadangdActivationTransaction({
    transactionId: randomUUID(),
    candidateVersion: fullVersion,
    appVersion: options.appVersion,
    recordBefore: record,
    snapshotDirName: madangdSnapshotDirName(fullVersion, startedAt.getTime()),
    now: startedAt
  })
  const beginMutating = (): void => {
    lock.retainOnError()
    // After mutation starts, cancellation would strand a stopped host; finish or roll back.
    options = withoutAbortSignal(options)
  }
  if (incumbent) {
    // Recount immediately before stop; the initial census may predate a long upload.
    const fenced = await runFencedStop({
      recountCensus: () =>
        countedLockedRecord(options, record)
          ? options.recountCensus()
          : Promise.reject(new Error('not the incumbent this update counted')),
      releaseIncumbentAdmission: options.releaseIncumbentAdmission,
      now: () => now().getTime(),
      refuse: (census) => {
        const plan = planMadangdUpdate({
          record,
          candidateVersion: fullVersion,
          census,
          candidateDaemonProtocol: CURRENT_MADANGD_DAEMON_PROTOCOL,
          ...(options.force !== undefined ? { force: options.force } : {})
        })
        return plan.action === 'defer' ? notActivated(plan.code, plan.reason) : null
      },
      prepare: () => writeMadangdActivationTransaction(options, transaction),
      stale: () =>
        notActivated(
          'madangd_update_terminal_census_unavailable',
          'The terminal count went stale before the current server could be stopped, so nothing ' +
            'was stopped. Madang will try the update again.'
        ),
      stop: () => {
        beginMutating()
        return stopTransactionIncumbent(options, incumbent, lock)
      },
      stopMayHaveBeenSent: (unstopped) => unstopped === null || unstopped.stopMayBeUnderway
    })
    if ('refused' in fenced) {
      return fenced.refused
    }
    if (fenced.stopped) {
      return notActivated(
        'madangd_outgoing_stop_incomplete',
        `${fenced.stopped.reason} No snapshot was taken and the candidate was not started. Madang ` +
          'requires matching runtime readiness before signaling an incumbent and confirmed exit ' +
          'before snapshotting.'
      )
    }
  } else {
    await writeMadangdActivationTransaction(options, transaction)
    beginMutating()
  }
  transaction = withMadangdActivationIncumbentStopped(transaction, now())
  await writeMadangdActivationTransaction(options, transaction)

  // Wait for confirmed exit before snapshotting; a live SQLite WAL is not a backup boundary.
  const snapshotDir = madangdSnapshotPath(options, transaction.snapshot.dirName)
  const captureOutput = await execMadangdStateMutationOr(
    options,
    captureMadangdStateSnapshotCommand(
      options.host,
      options.userDataDir,
      snapshotDir,
      madangdRemoteBaseDir(options.host, options.remoteHome),
      {
        snapshotsRoot: madangdSnapshotsRoot(options),
        keep: [transaction.snapshot.dirName, ...(record.snapshot ? [record.snapshot.dirName] : [])]
      }
    ),
    'FAILED'
  )
  const capture = parseMadangdSnapshotCapture(captureOutput)
  if (capture === 'failed') {
    const reason = madangdSnapshotFailureReason(captureOutput)
    const restarted = incumbent
      ? ` The incumbent was stopped before snapshotting; ${await restartAfterSnapshotFailure(options, incumbent, lock)}`
      : ''
    throw new Error(
      `Could not snapshot ${options.userDataDir} before activating ${fullVersion}` +
        `${reason ? `: ${reason}` : ''}. Madang's persisted state carries no schema version, so ` +
        'without a snapshot a rollback has no way back. Refusing to activate. Fix what stops ' +
        `the copy (often a full disk or quota on ${madangdRemoteBaseDir(options.host, options.remoteHome)}), ` +
        `then reconnect.${restarted}`
    )
  }
  const snapshot: MadangdStateSnapshot | null =
    capture === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: fullVersion,
          readableByVersion: record.active,
          takenAt: startedAt.toISOString()
        }
      : null
  transaction = withMadangdActivationSnapshot(transaction, capture, now())
  await writeMadangdActivationTransaction(options, transaction)

  const { verdict, launchError } = await launchAndJudgeMadangdSlot(options, {
    remoteInstallDir: remoteDir,
    fullVersion,
    buildHash: computeLocalMadangdBuildHash(options.localMadangdDir)
  })
  if (verdict.decision === 'reject') {
    const [code, reason] =
      launchError === undefined
        ? [verdict.code, verdict.reason]
        : [
            madangdCandidateLaunchFailureCode(launchError),
            `The candidate failed while starting: ${errorMessage(launchError)}`
          ]
    const restored = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: madangdSlotDir(options, transaction.candidateVersion),
      launchedVersion: transaction.candidateVersion,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: transaction.snapshot
    })
    const located =
      `${reason} Candidate stderr is at ` +
      `${joinRemotePath(options.host, remoteDir, MADANGD_LOG_FILENAME)}. ${restored}`
    return notActivated(code, await withMadangdLogTail(options, remoteDir, located))
  }

  const recordAfter = withActivatedVersion(record, fullVersion, snapshot, now(), options.appVersion)
  transaction = withMadangdActivationCandidateReady(transaction, recordAfter, now())
  await writeMadangdActivationTransaction(options, transaction)
  await writeMadangdActivationRecord(options, recordAfter)
  return { outcome: 'installed-and-activated', fullVersion, verdict }
}
