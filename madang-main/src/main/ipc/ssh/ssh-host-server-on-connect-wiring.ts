import { getAppEnvironment } from '../../../shared/app-environment'
import {
  getManagedMadangdFenceEnvironmentId,
  managedMadangdServerName
} from '../../../shared/managed-madangd-ssh-owner'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { findMadangdMigrationSourceCutoverForTarget } from '../../ssh/madangd-migration-cutover-journal'
import { abandonMadangdConversion } from '../../ssh/madangd-conversion-abandon'
import { retainMadangdMigrationSource } from '../../ssh/madangd-migration-source-retention'
import { hasMadangdTemplate } from '../../madangd/madangd-artifact-materializer'
import { isMadangdHostUnavailableFixableOnHost } from '../../madangd/madangd-host-unavailable'
import { managedServerUpdateDeps } from '../../ssh/managed-server-update-deps'
import { ensureMadangdManagedTunnel } from '../../managed-server/lifecycle/madangd-managed-tunnel'
import { verifyMadangdManagedServing } from '../../managed-server/lifecycle/madangd-managed-serving-verify'
import { convertSshTargetToManagedMadangd } from '../../managed-server/lifecycle/madangd-runtime-conversion'
import {
  madangdMigrationDestinationFor,
  madangdServerFolderCatalogFor,
  madangdServerRepositoriesFor
} from '../../managed-server/lifecycle/madangd-runtime-conversion-wiring'
import { createManagedMadangdEnvironment } from '../../managed-server/lifecycle/madangd-runtime-deployment'
import type { HostServerOnConnectDeps } from '../../ssh/ssh-host-server-on-connect'
import {
  censusSshHostRelaysBeforeSession,
  relayTerminalsOnConnect
} from '../../ssh/legacy-relay/ssh-host-relay-terminals-on-connect'
import { requireManagedMadangdInfrastructure } from '../../managed-server/lifecycle/madangd-managed-runtime-context'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { setSshHostServerStatus } from '../../ssh/ssh-host-server-status'
import { trackSshHostServerEvent } from '../../ssh/ssh-host-server-telemetry'
import { knownSshHostPlatform } from '../../ssh/ssh-host-platform-memo'
import { knownMadangdTunnelTransport } from '../../ssh/madangd-tunnel-transport-memo'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { releaseUnreachableMadangdSetup } from '../../ssh/madangd-unreachable-setup-release'
import { getCurrentMainWindow } from './ssh-ipc-context'
import { broadcastSshState } from './ssh-renderer-broadcast'
import { connectInFlight } from './ssh-connect-attempt-registry'
import { startLegacyRelayBridge } from '../../ssh/legacy-relay/legacy-relay-bridge-registry'
import { isBridgeableLease } from '../../ssh/legacy-relay/legacy-relay-bridge-leases'

export function hostServerOnConnectDeps(userDataPath: string): HostServerOnConnectDeps {
  const registry = getSshTargetRegistryStore()!
  const claims = registry.getMadangdRuntimeClaims()
  const store = registry.getMadangdMigrationSource()
  const appVersion = getAppEnvironment().getVersion()
  const isRegistered = (environmentId: string): boolean =>
    listEnvironments(userDataPath).some((entry) => entry.id === environmentId)
  return {
    // A fence alone may be unfinished setup; only registered servers count.
    managedEnvironmentId: (target) => {
      const environmentId = getManagedMadangdFenceEnvironmentId(target)
      return environmentId && isRegistered(environmentId) ? environmentId : null
    },
    ensureTunnel: async (environmentId) => {
      await ensureMadangdManagedTunnel(userDataPath, environmentId)
    },
    ensureServing: (environmentId) => verifyMadangdManagedServing(userDataPath, environmentId),
    retainCommittedSource: async (target) => {
      const head = findMadangdMigrationSourceCutoverForTarget(userDataPath, target.id)
      if (head?.phase === 'destination-committed') {
        await retainMadangdMigrationSource(userDataPath, head.migrationId, store)
      }
    },
    hasTemplate: hasMadangdTemplate,
    recordedUnavailable: (target) =>
      target.managedServerUnavailable?.appVersion === appVersion
        ? target.managedServerUnavailable.reason
        : null,
    recordUnavailable: (target, reason) => {
      if (!isMadangdHostUnavailableFixableOnHost(reason)) {
        registry.updateTarget(target.id, { managedServerUnavailable: { reason, appVersion } })
      }
    },
    ...managedServerUpdateDeps(userDataPath),
    isEmptyHost: (target) => {
      // An interrupted empty-host deploy passes its own claim, recorded by its provisioning intent.
      const environmentId = getManagedMadangdFenceEnvironmentId(target)
      return claims.preflight(
        target.id,
        environmentId
          ? { environmentId, recorded: target.madangdProvisioning !== undefined }
          : undefined
      ).claimable
    },
    relayTerminals: (target) =>
      relayTerminalsOnConnect({
        store,
        targetId: target.id,
        censusHost: async () =>
          censusSshHostRelaysBeforeSession(
            await requireManagedMadangdInfrastructure().connectionManager.connect(target),
            target.id
          )
      }),
    deploy: (target) =>
      createManagedMadangdEnvironment(userDataPath, {
        name: target.madangdProvisioning?.name ?? managedMadangdServerName(target),
        sshTargetId: target.id
      }),
    convert: async (target, hostProof) => {
      // COMPAT(legacy-relay-bridge): find the panes old relays still run before the tabs remount.
      if (hostProof?.bridged) {
        await startLegacyRelayBridge(target.id)
      }
      const converted = await convertSshTargetToManagedMadangd(userDataPath, {
        sshTargetId: target.id,
        name: managedMadangdServerName(target),
        // The connect's own census already answered; a conversion before any session reuses it.
        censusHost: (host) =>
          hostProof ? Promise.resolve(hostProof) : censusHostRelayTerminalsFor(host)(),
        isBridgedPaneLease: isBridgeableLease,
        // Releasing the direct session here would cancel the connect that requested conversion.
        destinationFor: madangdMigrationDestinationFor,
        serverRepositoriesFor: madangdServerRepositoriesFor,
        serverFolderCatalogFor: madangdServerFolderCatalogFor
      })
      if (converted.outcome === 'converted' || converted.outcome === 'refused') {
        // Move-anyway consent covers one attempt; retain it on failure so held-fence verification can resume.
        registry.updateTarget(target.id, { managedServerLeaveBehind: undefined })
      }
      return converted
    },
    abandonDeploy: async (target) => {
      const environmentId =
        getManagedMadangdFenceEnvironmentId(target) ??
        getManagedMadangdFenceEnvironmentId(registry.getTarget(target.id))
      if (environmentId && !isRegistered(environmentId)) {
        claims.release(target.id, environmentId)
        await claims.flush()
      }
    },
    hasUnfinishedConversion: (target) => {
      const head = findMadangdMigrationSourceCutoverForTarget(userDataPath, target.id)
      return (
        head !== null &&
        !head.supersedesMigrationId &&
        (head.phase === 'source-fenced' || head.phase === 'destination-staged')
      )
    },
    abandonConversion: async (target) => {
      await abandonMadangdConversion({
        userDataPath,
        store,
        claims,
        targetId: target.id,
        destinationFor: madangdMigrationDestinationFor
      })
    },
    isFencedBeforeStaging: (target) =>
      findMadangdMigrationSourceCutoverForTarget(userDataPath, target.id)?.phase === 'source-fenced',
    releaseUnreachableSetup: (target) =>
      releaseUnreachableMadangdSetup({ userDataPath, claims, targetId: target.id }),
    // Read at report time: a deploy or conversion learns the platform while the decision runs.
    report: (target, event) =>
      trackSshHostServerEvent(
        event,
        knownSshHostPlatform(target.id),
        knownMadangdTunnelTransport(target.id)
      ),
    progress: (target, phase) => {
      // Cancelled decisions keep running; their progress must not revive connection status.
      if (!connectInFlight.has(target.id)) {
        return
      }
      setSshHostServerStatus(target.id, { kind: 'setting-up', phase })
      broadcastSshState(getCurrentMainWindow, target.id, {
        targetId: target.id,
        status: 'connecting',
        error: null,
        reconnectAttempt: 0
      })
    }
  }
}
