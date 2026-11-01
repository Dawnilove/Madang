// Target claims preserve environment identity so interrupted deploys resume the same registration.
import { getAppEnvironment } from '../../../shared/app-environment'
import { randomUUID } from 'node:crypto'
import { assertRuntimeEnvironmentNotReconciling } from '../../../shared/runtime-environment-reconciliation-record'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { addManagedMadangdEnvironment } from '../../../shared/runtime-environment-managed-madangd-store'
import {
  getMadangdSshDeployment,
  redactRuntimeEnvironment
} from '../../../shared/runtime-environments'
import {
  MADANGD_MANAGED_REMOTE_PORT,
  type MadangdManagedDeferral,
  type MadangdManagedDeployResult
} from '../../../shared/madangd-managed-runtime'
import { getManagedMadangdFenceEnvironmentId } from '../../../shared/managed-madangd-ssh-owner'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { materializeMadangdArtifact } from '../../madangd/madangd-artifact-materializer'
import {
  closeMadangdManagedTunnel,
  ensureMadangdManagedTunnel,
  startMadangdManagedTunnel
} from './madangd-managed-tunnel'
import { recoverInterruptedMadangdActivation } from '../activation/madangd-activation-recovery'
import { wakeAlreadyActiveMadangd } from '../../ssh/madangd-already-active-wake'
import { readMadangdActivationRecord } from '../activation/madangd-activation-record-store'
import { resolveMadangdRemoteContext, type MadangdRemoteContext } from '../install/madangd-remote-context'
import { deployMadangd } from '../../ssh/madangd-remote-deploy'
import {
  adoptRunningMadangdVersion,
  type MadangdRunningAdoption
} from '../../ssh/madangd-running-version-adoption'
import { readLocalFullVersion } from '../install/remote-versioned-install'
import { sshMadangdHostTransport } from '../../ssh/madangd-ssh-host-transport'
import { MADANGD_ACTIVATION_POLICY_REFUSED_CODE } from '../../ssh/madangd-installed-activation'
import { pruneManagedMadangdVersions } from './madangd-managed-version-gc'
import { tunneledMadangdPairingCode } from '../../ssh/madangd-tunneled-pairing'
import { resolveMadangdMigrationFence } from '../../ssh/madangd-migration-source-fence'
import type { SshTarget } from '../../../shared/ssh-types'
import { findCollidingEnvironmentName } from '../../../shared/runtime-environment-name-collision'
import { deployedMadangdTunnelChecks } from './madangd-managed-tunnel-identity'
import {
  isForceableMadangdDeferral,
  managedMadangdDeployPolicy,
  managedMadangdSlot,
  probeManagedMadangdReadiness,
  requireManagedMadangdInfrastructure
} from './madangd-managed-runtime-context'

export async function createManagedMadangdEnvironment(
  userDataPath: string,
  args: {
    name: string
    sshTargetId: string
    force?: boolean
    signal?: AbortSignal
    migration?: boolean
  }
): Promise<MadangdManagedDeployResult> {
  return runTargetLifecycle(args.sshTargetId, async () => {
    const { connectionManager, targetStore, claims } = requireManagedMadangdInfrastructure()
    const environmentId =
      getManagedMadangdFenceEnvironmentId(targetStore.getTarget(args.sshTargetId)) ?? randomUUID()
    const environments = listEnvironments(userDataPath)
    const registered = environments.find((entry) => entry.id === environmentId)
    if (registered) {
      assertRuntimeEnvironmentNotReconciling(registered)
      if (getMadangdSshDeployment(registered)?.sshTargetId !== args.sshTargetId) {
        throw new Error('The SSH target is owned by a server that is not deployed on it.')
      }
    }
    const namesake = findCollidingEnvironmentName(
      environments.filter((entry) => entry.id !== environmentId),
      args.name
    )
    if (namesake) {
      throw new Error(`A server named "${namesake.name}" already exists.`)
    }
    const current = targetStore.getTarget(args.sshTargetId)
    if (args.migration) {
      assertMigrationFence(userDataPath, current, environmentId, args.name)
    }
    const claimed = claims.claim(args.sshTargetId, environmentId, {
      ...(args.migration ? {} : { deployName: args.name }),
      ownerRecorded:
        Boolean(args.migration) || Boolean(current?.madangdProvisioning) || Boolean(registered)
    })
    await claims.flush(args.signal)
    const targetGeneration = claimed.generation
    if (targetGeneration === undefined) {
      throw new Error(
        'The SSH registration for this host’s Madang server has no durable generation.'
      )
    }
    if (registered && getMadangdSshDeployment(registered)?.sshTargetGeneration !== targetGeneration) {
      throw new Error('The saved Madang server for this host has a stale SSH target generation.')
    }
    let environmentRegistered = false
    try {
      const connection = await connectionManager.connect(claimed)
      let context = await resolveMadangdRemoteContext(
        claimed,
        sshMadangdHostTransport(connection),
        args.signal
      )
      const slot = managedMadangdSlot(context, MADANGD_MANAGED_REMOTE_PORT, args.signal)
      const recovery = await recoverInterruptedMadangdActivation(slot)
      if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
        throw new Error(recovery.reason)
      }
      if (recovery.outcome === 'recovered') {
        context = { ...context, activationRecord: await readMadangdActivationRecord(slot) }
      }
      if (registered) {
        environmentRegistered = true
        const current = await ensureMadangdManagedTunnel(userDataPath, registered.id)
        const activeVersion = context.activationRecord.active
        if (!activeVersion) {
          throw new Error('This host’s Madang server has no active runtime version.')
        }
        return {
          outcome: 'already-current',
          environment: redactRuntimeEnvironment(current),
          activeVersion
        }
      }
      const localMadangdDir = await materializeMadangdArtifact(context.serverTarget, {
        signal: args.signal
      })
      // Adopt before upload: only the paired incumbent can count terminals; redeploy would defer.
      const localVersion = readLocalFullVersion(localMadangdDir)
      const adopted = args.force
        ? null
        : await adoptRunningMadangdVersion(slot, context.activationRecord, localVersion)
      const { active } = context.activationRecord
      if (!adopted && !args.force && active && active !== localVersion) {
        // Wake may observe a peer's changed record; census admission must use that same record.
        context = { ...context, activationRecord: await readMadangdActivationRecord(slot) }
      }
      const serving: DeployedMadangd | MadangdManagedDeferral =
        adopted ??
        (await deployOwnMadangd(context, { ...slot, conn: connection }, localMadangdDir, args))
      if ('outcome' in serving) {
        return serving
      }
      // Read the bound port: the preferred port may belong to another host process.
      const tunnel = deployedMadangdTunnelChecks(serving.readiness, serving.reprobe)
      const localPort = await startMadangdManagedTunnel(
        environmentId,
        claimed,
        connection,
        tunnel.remotePort,
        { ...tunnel, preferredPort: MADANGD_MANAGED_REMOTE_PORT }
      )
      const environment = addManagedMadangdEnvironment(userDataPath, {
        id: environmentId,
        name: args.name,
        pairingCode: tunneledMadangdPairingCode(tunnel.readiness(), localPort),
        madangdDeployment: {
          sshTargetId: claimed.id,
          sshTargetGeneration: targetGeneration,
          localPort,
          remotePort: MADANGD_MANAGED_REMOTE_PORT
        }
      })
      environmentRegistered = true
      return {
        outcome: serving.created ? 'created' : 'already-current',
        environment: redactRuntimeEnvironment(environment),
        activeVersion: serving.version
      }
    } finally {
      if (!environmentRegistered) {
        await closeMadangdManagedTunnel(environmentId).catch(() => undefined)
      }
    }
  })
}

type DeployedMadangd = MadangdRunningAdoption & { created?: true }

async function deployOwnMadangd(
  context: MadangdRemoteContext<SshTarget>,
  slot: ReturnType<typeof managedMadangdSlot>,
  localMadangdDir: string,
  args: { force?: boolean; signal?: AbortSignal }
): Promise<DeployedMadangd | MadangdManagedDeferral> {
  const appVersion = getAppEnvironment().getVersion()
  const deployResult = await deployMadangd({
    ...slot,
    localMadangdDir,
    target: context.serverTarget,
    ...managedMadangdDeployPolicy(context, appVersion, args.force ? 'force' : 'connect'),
    force: args.force,
    appVersion
  })
  if (deployResult.outcome === 'installed-not-activated') {
    return {
      outcome: 'deferred',
      candidateVersion: deployResult.fullVersion,
      code: deployResult.code,
      reason: deployResult.reason,
      forceable:
        isForceableMadangdDeferral(deployResult.code) ||
        deployResult.code === MADANGD_ACTIVATION_POLICY_REFUSED_CODE
    }
  }
  if (deployResult.outcome === 'already-active') {
    await wakeAlreadyActiveMadangd(slot)
  }
  const reprobe = () =>
    probeManagedMadangdReadiness(context, localMadangdDir, deployResult.fullVersion, args.signal)
  const readiness = await reprobe()
  await pruneManagedMadangdVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployResult.fullVersion,
    readiness
  })
  return {
    version: deployResult.fullVersion,
    readiness,
    reprobe,
    ...(deployResult.outcome === 'already-active' ? {} : { created: true as const })
  }
}

function assertMigrationFence(
  userDataPath: string,
  target: SshTarget | undefined,
  environmentId: string,
  name: string
): void {
  const fence = target ? resolveMadangdMigrationFence(userDataPath, target) : null
  if (
    fence?.state !== 'fenced' ||
    fence.cutover.destinationEnvironmentId !== environmentId ||
    fence.cutover.destinationName !== name
  ) {
    throw new Error('madangd_migration_fence_required')
  }
}
