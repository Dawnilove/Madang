/** IPC for a host an older build changed after conversion: move its newer projects, or keep the server's. */
import { ipcMain } from 'electron'
import type {
  MadangdDeltaMovePreview,
  MadangdDeltaMoveResult
} from '../../../shared/madangd-managed-runtime'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { requireManagedMadangdInfrastructure } from '../../managed-server/lifecycle/madangd-managed-runtime-context'
import { ensureMadangdManagedTunnel } from '../../managed-server/lifecycle/madangd-managed-tunnel'
import { keepMadangdServerVersion, runMadangdDeltaMove } from '../../ssh/madangd-migration-delta-move'
import { planMadangdDeltaMove } from '../../ssh/madangd-migration-delta-plan'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { madangdMigrationDestinationFor } from '../../managed-server/lifecycle/madangd-runtime-conversion-wiring'
import { requiredString } from './madangd-runtime-lifecycle-handlers'
import { publishResolvedChangedHostStatus } from './runtime-environment-managed-tunnel'
import { runTargetLifecycle } from '../ssh/ssh-target-lifecycle-queue'

export function registerMadangdDeltaMoveHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:previewMadangdDeltaMove',
    (_event, args: { sshTargetId: string }): MadangdDeltaMovePreview => {
      const { store, target } = requireChangedHost(args)
      const plan = planMadangdDeltaMove(getUserDataPath(), store, target)
      const { sshTargetId, environmentId, added, notReflected, blockers } = plan
      return { sshTargetId, environmentId, added, notReflected, blockers }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:moveMadangdDelta',
    async (_event, args: { sshTargetId: string }): Promise<MadangdDeltaMoveResult> => {
      const userDataPath = getUserDataPath()
      const { store, claims, target } = requireChangedHost(args)
      const environment = listEnvironments(userDataPath).find(
        (entry) => entry.id === target.madangdFence?.environmentId
      )
      if (!environment) {
        throw new Error('This host’s Madang server is no longer registered.')
      }
      const result = await runMadangdDeltaMove({
        userDataPath,
        store,
        claims,
        target,
        environment,
        connectDestination: async () =>
          madangdMigrationDestinationFor(
            await ensureMadangdManagedTunnel(userDataPath, environment.id)
          ),
        censusHost: censusHostRelayTerminalsFor(target),
        runTargetLifecycle
      })
      if (result.outcome === 'moved') {
        publishResolvedChangedHostStatus(target, environment.id)
      }
      return result
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:keepMadangdServerVersion',
    async (_event, args: { sshTargetId: string }): Promise<void> => {
      const { store, claims, target, environmentId } = requireChangedHost(args)
      await runTargetLifecycle(target.id, () =>
        keepMadangdServerVersion({ userDataPath: getUserDataPath(), store, claims, target })
      )
      publishResolvedChangedHostStatus(target, environmentId)
    }
  )
}

function requireChangedHost(args: { sshTargetId: string } | undefined) {
  const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
  const { targetStore, claims } = requireManagedMadangdInfrastructure()
  const store = targetStore.getMadangdMigrationSource()
  const target = store.getSshTarget(sshTargetId)
  if (!target?.madangdFence?.sourceChangedAt) {
    throw new Error('This SSH host has no changes from an older Madang to resolve.')
  }
  return { store, claims, target, environmentId: target.madangdFence.environmentId }
}
