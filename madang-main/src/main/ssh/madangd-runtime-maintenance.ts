/** Census through the managed tunnel before lifecycle changes. Unknown counts never mean zero, so live/uncounted hosts defer update (D7). */
import { getAppEnvironment } from '../../shared/app-environment'
import { assertRuntimeEnvironmentNotReconciling } from '../../shared/runtime-environment-reconciliation-record'
import {
  redactRuntimeEnvironment,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import type {
  MadangdManagedDeployResult,
  MadangdManagedPastLiveTerminals,
  MadangdManagedRecoveryResult,
  MadangdManagedRollbackResult
} from '../../shared/madangd-managed-runtime'
import { runTargetLifecycle } from '../ipc/ssh/ssh-target-lifecycle-queue'
import { recoverInterruptedMadangdActivation } from '../managed-server/activation/madangd-activation-recovery'
import { probeActiveMadangdReadiness } from './madangd-active-readiness'
import { materializeMadangdArtifact } from '../madangd/madangd-artifact-materializer'
import { CURRENT_MADANGD_DAEMON_PROTOCOL } from './madangd-daemon-protocol-crossing'
import { rebuildMadangdManagedTunnel } from '../managed-server/lifecycle/madangd-managed-tunnel'
import { wakeAlreadyActiveMadangd } from './madangd-already-active-wake'
import {
  clearManagedMadangdUpdateDeferral,
  recordManagedMadangdUpdateDeferral
} from '../managed-server/lifecycle/madangd-managed-update-deferrals'
import {
  isForceableMadangdDeferral,
  managedMadangdInstallDir,
  managedMadangdSlot,
  probeManagedMadangdReadiness,
  requireManagedMadangdEnvironment,
  resolveLinkedMadangdContext
} from '../managed-server/lifecycle/madangd-managed-runtime-context'
import type { MadangdRemoteContext } from '../managed-server/install/madangd-remote-context'
import { readRemoteMadangdBuildHash } from '../managed-server/install/madangd-remote-build-hash'
import { deployMadangd, type MadangdDeployOptions } from './madangd-remote-deploy'
import type { MadangdUpdateForce } from './madangd-update-plan'
import { MADANGD_ACTIVATION_POLICY_REFUSED_CODE } from './madangd-installed-activation'
import { pruneManagedMadangdVersions } from '../managed-server/lifecycle/madangd-managed-version-gc'
import { clearMadangdUpdateFailedThisLaunch } from '../managed-server/lifecycle/madangd-managed-update-failure-memory'
import { admitMadangdRecordForIntent } from '../managed-server/lifecycle/madangd-managed-update-decision'
import { rollbackMadangd } from '../managed-server/install/madangd-remote-rollback'
import { collectManagedTerminalCensus } from './madangd-terminal-census-client'
import { updateTerminalCounts } from './madangd-fenced-stop'
import { findIncompleteManagedMadangdMigration } from '../managed-server/lifecycle/madangd-managed-migration-status'
import { latestMadangdMigrationInto } from './madangd-migration-rollback-mark'
import { refreshMaintainedMadangdPairing } from './madangd-maintenance-pairing-refresh'

type LifecycleArgs = { selector: string; signal?: AbortSignal }

export function withManagedMadangdLifecycle<T>(
  userDataPath: string,
  selector: string,
  run: (managed: ReturnType<typeof requireManagedMadangdEnvironment>) => Promise<T>
): Promise<T> {
  const { environment, deployment } = requireManagedMadangdEnvironment(userDataPath, selector)
  return runTargetLifecycle(deployment.sshTargetId, async () => {
    // Re-read in the lifecycle queue because reconciliation/stop may have won first.
    const current = requireManagedMadangdEnvironment(userDataPath, environment.id)
    assertRuntimeEnvironmentNotReconciling(current.environment)
    return run(current)
  })
}

/** Rebuild forwarding when a launched slot binds a different port. */
export async function followLaunchedServerPort(
  userDataPath: string,
  environmentId: string
): Promise<void> {
  try {
    await rebuildMadangdManagedTunnel(userDataPath, environmentId)
  } catch (error) {
    // Server already launched; if tunnel rebuild fails, the next connect can forward its bound port.
    console.warn('[ssh] Could not forward to the relaunched managed Madang server:', error)
  }
}

export function updateManagedMadangdEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { force?: boolean; pastLiveTerminals?: MadangdManagedPastLiveTerminals }
): Promise<MadangdManagedDeployResult> {
  const { pastLiveTerminals } = args
  // Update anyway keeps Update's version admission even if a caller also passed force.
  const intent = args.force && !pastLiveTerminals ? 'force' : 'update'
  return withManagedMadangdLifecycle(userDataPath, args.selector, async (managed) => {
    const admitIntent = admitMadangdRecordForIntent(intent, getAppEnvironment().getVersion())
    // Checked under the host fence: another desktop may have activated a build since the confirm.
    const admitRecord: NonNullable<MadangdDeployOptions['admitRecord']> = pastLiveTerminals
      ? (record, candidateVersion) =>
          record.active !== pastLiveTerminals.incumbentVersion
            ? "This host's server changed since the update was confirmed. Review it and update again."
            : admitIntent(record, candidateVersion)
      : admitIntent
    const force: MadangdUpdateForce | undefined = pastLiveTerminals ? 'live-terminals' : args.force
    const result = await runManagedMadangdUpdate(
      userDataPath,
      managed,
      await resolveLinkedMadangdContext(managed.environment, managed.deployment, args.signal),
      { signal: args.signal, force, admitRecord }
    )
    // A completed manual update clears automatic failure suppression; deferred attempts do not.
    if (result.outcome !== 'deferred') {
      clearMadangdUpdateFailedThisLaunch({ kind: 'ssh', id: managed.deployment.sshTargetId })
    }
    return result
  })
}

export async function runManagedMadangdUpdate(
  userDataPath: string,
  { environment, deployment }: ReturnType<typeof requireManagedMadangdEnvironment>,
  context: MadangdRemoteContext,
  args: {
    force?: MadangdUpdateForce
    signal?: AbortSignal
    localMadangdDir?: string
    admitRecord?: MadangdDeployOptions['admitRecord']
  }
): Promise<MadangdManagedDeployResult> {
  const { countFirst, ...recount } = updateTerminalCounts((options) =>
    collectManagedTerminalCensus(
      userDataPath,
      environment,
      context.activationRecord,
      undefined,
      options
    )
  )
  const census = await countFirst()
  const localMadangdDir =
    args.localMadangdDir ??
    (await materializeMadangdArtifact(context.serverTarget, { signal: args.signal }))
  const slot = managedMadangdSlot(context, deployment.remotePort, args.signal)
  const result = await deployMadangd({
    ...slot,
    localMadangdDir,
    target: context.serverTarget,
    census,
    ...recount,
    censusRecord: context.activationRecord,
    force: args.force,
    appVersion: getAppEnvironment().getVersion(),
    ...(args.admitRecord ? { admitRecord: args.admitRecord } : {})
  })
  if (result.outcome === 'installed-not-activated') {
    const deferral = {
      outcome: 'deferred' as const,
      candidateVersion: result.fullVersion,
      code: result.code,
      reason: result.reason,
      // Force may override policy deferrals, including a newer host build.
      forceable:
        isForceableMadangdDeferral(result.code) ||
        result.code === MADANGD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Policy refusal is final for this host, not a transient update to retry.
    if (result.code !== MADANGD_ACTIVATION_POLICY_REFUSED_CODE) {
      recordManagedMadangdUpdateDeferral(environment.id, deferral)
    }
    return deferral
  }
  clearManagedMadangdUpdateDeferral(environment.id)
  const started = result.outcome === 'already-active' && (await wakeAlreadyActiveMadangd(slot))
  const readiness = await probeManagedMadangdReadiness(
    context,
    localMadangdDir,
    result.fullVersion,
    args.signal
  )
  await pruneManagedMadangdVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: result.fullVersion,
    readiness
  })
  const updated = refreshMaintainedMadangdPairing(userDataPath, environment.id, readiness)
  if (started || result.outcome !== 'already-active') {
    await followLaunchedServerPort(userDataPath, environment.id)
  }
  return {
    outcome: result.outcome === 'already-active' ? 'already-current' : 'updated',
    environment: redactRuntimeEnvironment(updated),
    activeVersion: result.fullVersion
  }
}

export function rollbackManagedMadangdEnvironment(
  userDataPath: string,
  args: LifecycleArgs
): Promise<MadangdManagedRollbackResult> {
  return withManagedMadangdLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedMadangdContext(environment, deployment, args.signal)
      const record = context.activationRecord
      const target = record.previous
      if (!target) {
        return {
          outcome: 'refused',
          code: 'madangd_rollback_no_target',
          reason: 'This server has no previous version to roll back to.'
        }
      }
      const crossing = migrationRollbackRefusal(userDataPath, environment, record.activatedAt)
      if (crossing) {
        return crossing
      }
      const slot = managedMadangdSlot(context, deployment.remotePort, args.signal)
      const targetDir = managedMadangdInstallDir(context, target)
      const targetBuildHash = await readRemoteMadangdBuildHash(slot, targetDir)
      const { countFirst, ...recount } = updateTerminalCounts((options) =>
        collectManagedTerminalCensus(userDataPath, environment, record, undefined, options)
      )
      // Recount under lock before rollback stop; this initial census closes no admission.
      const census = await countFirst()
      // Require idle because this client cannot prove the older build's daemon protocol attaches to live terminals.
      if (census.liveSessions !== 0) {
        return {
          outcome: 'refused',
          code:
            census.liveSessions === null
              ? 'madangd_rollback_census_unavailable'
              : 'madangd_rollback_terminals_running',
          reason:
            census.liveSessions === null
              ? 'The server did not answer how many terminals it runs. Retry when it answers.'
              : 'Close the terminals running on this server before rolling it back.'
        }
      }
      const result = await rollbackMadangd({
        ...slot,
        record,
        census,
        ...recount,
        targetBuildHash,
        targetDaemonProtocol: CURRENT_MADANGD_DAEMON_PROTOCOL
      })
      if (result.outcome !== 'rolled-back') {
        return result
      }
      const readiness = await probeActiveMadangdReadiness(
        { ...slot, remoteInstallDir: targetDir },
        { buildHash: targetBuildHash, fullVersion: result.target }
      )
      const updated = refreshMaintainedMadangdPairing(userDataPath, environment.id, readiness)
      await followLaunchedServerPort(userDataPath, environment.id)
      return {
        outcome: 'rolled-back',
        environment: redactRuntimeEnvironment(updated),
        activeVersion: result.target,
        discarded: result.discarded
      }
    }
  )
}

export function recoverManagedMadangdEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { acceptChangedState?: boolean }
): Promise<MadangdManagedRecoveryResult> {
  return withManagedMadangdLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedMadangdContext(environment, deployment, args.signal)
      const result = await recoverInterruptedMadangdActivation({
        ...managedMadangdSlot(context, deployment.remotePort, args.signal),
        acceptChangedState: args.acceptChangedState === true
      })
      if (result.outcome !== 'recovered') {
        return result
      }
      const updated = result.readiness
        ? refreshMaintainedMadangdPairing(userDataPath, environment.id, result.readiness)
        : environment
      if (result.activeVersion) {
        await followLaunchedServerPort(userDataPath, environment.id)
      }
      return {
        outcome: 'recovered',
        resolution: result.resolution,
        activeVersion: result.activeVersion,
        environment: redactRuntimeEnvironment(updated)
      }
    }
  )
}

/** A post-activation migration is absent from the rollback snapshot; restoring it would discard imported state. */
function migrationRollbackRefusal(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  activatedAt: string | null
): MadangdManagedRollbackResult | null {
  if (findIncompleteManagedMadangdMigration(userDataPath, environment.id)) {
    return {
      outcome: 'refused',
      code: 'madangd_rollback_migration_in_progress',
      reason: 'A migration into this server is still running. Finish it before rolling back.'
    }
  }
  const migratedAt = latestMadangdMigrationInto(userDataPath, environment)
  if (migratedAt && (activatedAt === null || Date.parse(activatedAt) < Date.parse(migratedAt))) {
    return {
      outcome: 'refused',
      code: 'madangd_rollback_crosses_migration',
      reason:
        "The previous version's state predates the projects migrated onto this server; " +
        'rolling back would lose them. Deploy forward instead.'
    }
  }
  return null
}
