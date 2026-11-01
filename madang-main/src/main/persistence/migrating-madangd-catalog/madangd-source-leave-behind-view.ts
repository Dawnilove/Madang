// Offer "Move anyway" only when a consent-free preview shows it clears the blockers.
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { collectMadangdMigrationUntransferredDependencyCensus } from './madangd-source-dependency-census'
import { collectMadangdMigrationSourceDormantState } from './madangd-source-dormant-state'
import type { MadangdMigrationDeltaView } from './madangd-source-delta-view'

export function createMadangdMigrationLeaveBehindView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  targetId: string
): MadangdMigrationDeltaView {
  // Read-only collectors make a shallow copy sufficient.
  const state = {
    ...runtime.state,
    sshTargets: runtime.state.sshTargets.map((target) =>
      target.id === targetId
        ? { ...target, managedServerLeaveBehind: { confirmedAt: new Date(0).toISOString() } }
        : target
    )
  }
  const storage = runtime.terminalScrollbackSnapshotStorage
  return {
    getRepos: () => state.repos,
    getFolderWorkspaces: () => state.folderWorkspaces,
    getProjectGroups: () => state.projectGroups,
    collectMadangdMigrationSourceDormantState: (source, catalog, destinationEnvironmentId) =>
      collectMadangdMigrationSourceDormantState(
        state,
        source,
        catalog,
        storage,
        destinationEnvironmentId
      ).payload,
    inspectMadangdMigrationUntransferredDependencies: (manifest) =>
      collectMadangdMigrationUntransferredDependencyCensus(state, manifest, storage)
  }
}
