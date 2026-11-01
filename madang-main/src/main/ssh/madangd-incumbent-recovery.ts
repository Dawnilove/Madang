/** Restore changed state only after proven slot exit and operator consent: a launched RPC server may have created terminals the stopped host cannot census, making the snapshot stale. Use the same rule for failure and crash recovery. */
import { execMadangdStateMutation } from '../managed-server/host-state/madangd-state-mutation-exec'
import { madangdRemoteBaseDir } from '../managed-server/install/madangd-remote-windows-node'
import type { ServeReadiness } from '../server/serve-readiness'
import { RELAY_REMOTE_DIR } from './remote-exec/remote-frame-protocol'
import { MADANGD_STATE_SNAPSHOT_DIR } from '../managed-server/activation/madangd-activation-record'
import type { MadangdSnapshotVerdict } from '../managed-server/activation/madangd-activation-transaction'
import {
  clearMadangdStateSnapshotMembersCommand,
  compareMadangdStateSnapshotCommand,
  madangdSnapshotIsUnchanged,
  parseMadangdSnapshotRestore,
  restoreMadangdStateSnapshotCommand
} from '../managed-server/host-state/madangd-state-snapshot'
import { execMadangdRemote } from '../managed-server/install/madangd-remote-runtime-control'
import {
  ensureMadangdSlotServing,
  launchMadangdSlot,
  quiesceInterruptedMadangdSlot,
  type MadangdSlotIdentity,
  type MadangdSlotOptions
} from './madangd-recovery-slot'
import { joinRemotePath } from './ssh-remote-platform'
import { MADANGD_RECOVERY_CHANGED_STATE_CODE } from '../../shared/madangd-managed-runtime'

export type MadangdIncumbentRecoveryOptions = MadangdSlotOptions & {
  /** The operator accepted restoring the snapshot over state a launched build changed. */
  acceptChangedState?: boolean
}

type MadangdIncumbentRecovery =
  | { outcome: 'restored'; readiness: ServeReadiness | null }
  | { outcome: 'refused'; verdict: 'live' | 'unverifiable'; code: string; reason: string }

export function madangdSnapshotPath(options: MadangdSlotOptions, dirName: string): string {
  return joinRemotePath(
    options.host,
    options.remoteHome,
    RELAY_REMOTE_DIR,
    MADANGD_STATE_SNAPSHOT_DIR,
    dirName
  )
}

/** Unverifiable steps throw so the caller retains the fence. */
export async function recoverMadangdIncumbent(
  options: MadangdIncumbentRecoveryOptions,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: MadangdSlotIdentity | null
    restoreState: MadangdSnapshotVerdict | null
    /** Rollback may restore a different snapshot from the launched slot's starting state. */
    launchedFromState?: MadangdSnapshotVerdict | null
    /** This run itself proved both slots exited, so no fresh liveness probe is needed. */
    slotsProvenExited?: boolean
  }
): Promise<MadangdIncumbentRecovery> {
  const quiescence =
    input.slotsProvenExited || !input.restoreState
      ? 'exited'
      : await quiesceInterruptedMadangdSlot(options, input.launchedVersion, input.incumbent)
  // With no incumbent there is no older reader to protect; the record names nothing to serve.
  if (quiescence === 'exited' && input.restoreState && input.incumbent) {
    const decision = input.launchedVersion
      ? await decideChangedStateRestore(options, input.launchedFromState ?? input.restoreState)
      : 'restore'
    if (decision !== 'restore' && decision !== 'unchanged') {
      return decision
    }
    // A launched slot that left its starting state untouched still sits on a root to replace.
    if (decision === 'restore' || input.launchedFromState) {
      await restoreState(options, input.restoreState)
    }
  }
  if (!input.incumbent) {
    return { outcome: 'restored', readiness: null }
  }
  return {
    outcome: 'restored',
    readiness: input.slotsProvenExited
      ? await launchMadangdSlot(options, input.incumbent)
      : await ensureMadangdSlotServing(options, input.incumbent)
  }
}

async function decideChangedStateRestore(
  options: MadangdIncumbentRecoveryOptions,
  state: MadangdSnapshotVerdict
): Promise<'unchanged' | 'restore' | Extract<MadangdIncumbentRecovery, { outcome: 'refused' }>> {
  if (state.state === 'captured') {
    const snapshotDir = madangdSnapshotPath(options, state.dirName)
    // A lost read-only comparison can conservatively mean changed.
    const comparison = await execMadangdRemote(
      options,
      compareMadangdStateSnapshotCommand(
        options.host,
        options.userDataDir,
        snapshotDir,
        madangdRemoteBaseDir(options.host, options.remoteHome)
      )
    ).catch(() => '')
    if (madangdSnapshotIsUnchanged(comparison)) {
      return 'unchanged'
    }
  }
  if (options.acceptChangedState) {
    return 'restore'
  }
  const retained =
    state.state === 'captured' ? ` at ${madangdSnapshotPath(options, state.dirName)}` : ''
  return {
    outcome: 'refused',
    verdict: 'unverifiable',
    code: MADANGD_RECOVERY_CHANGED_STATE_CODE,
    reason:
      'The launched build is stopped, but it changed profile state (or the change could not be ' +
      'checked), so the previous build was not restarted against it and this host serves ' +
      'nothing. Recover to restore the prelaunch snapshot' +
      `${retained} and restart the previous build; terminals the launched build started keep ` +
      'running but drop out of the restored state.'
  }
}

async function restoreState(options: MadangdSlotOptions, state: MadangdSnapshotVerdict): Promise<void> {
  if (state.state === 'pending') {
    throw new Error('The interrupted transaction has no durable snapshot verdict.')
  }
  const command =
    state.state === 'captured'
      ? restoreMadangdStateSnapshotCommand(
          options.host,
          options.userDataDir,
          madangdSnapshotPath(options, state.dirName),
          madangdRemoteBaseDir(options.host, options.remoteHome)
        )
      : clearMadangdStateSnapshotMembersCommand(
          options.host,
          options.userDataDir,
          madangdRemoteBaseDir(options.host, options.remoteHome)
        )
  const restored = parseMadangdSnapshotRestore(await execMadangdStateMutation(options, command))
  if (restored !== 'restored') {
    throw new Error(`The prelaunch state could not be restored (${restored}).`)
  }
}
