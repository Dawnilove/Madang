// Export only additions from older builds by subtracting prior migrations from a profile copy.
import type {
  MadangdMigrationCatalogPayload,
  MadangdMigrationDormantStatePayload,
  MadangdMigrationManifest,
  MadangdMigrationManifestSource
} from '../../../shared/madangd-migration/madangd-migration-manifest'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { subtractMadangdSourceCatalogState } from './madangd-source-catalog-subtraction'
import {
  collectMadangdMigrationUntransferredDependencyCensus,
  type MadangdMigrationSourceDependencyCensus
} from './madangd-source-dependency-census'
import { subtractMadangdMigrationSourceDormantState } from './madangd-source-dormant-subtraction'
import { collectMadangdMigrationSourceDormantState } from './madangd-source-dormant-state'
import { subtractMadangdMigrationScopeWorkspaceSession } from './madangd-source-workspace-session-subtraction'

export type MadangdMigrationDeltaView = {
  getRepos: () => Repo[]
  getFolderWorkspaces: () => FolderWorkspace[]
  getProjectGroups: () => ProjectGroup[]
  collectMadangdMigrationSourceDormantState: (
    source: MadangdMigrationManifestSource,
    catalog: MadangdMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ) => MadangdMigrationDormantStatePayload
  inspectMadangdMigrationUntransferredDependencies: (
    manifest: MadangdMigrationManifest
  ) => MadangdMigrationSourceDependencyCensus
}

/** moved includes today's edits to previously migrated rows. */
export function createMadangdMigrationDeltaView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  moved: MadangdMigrationManifest
): MadangdMigrationDeltaView {
  const state = structuredClone(runtime.state)
  subtractMadangdSourceCatalogState(state, moved)
  subtractMadangdMigrationSourceDormantState(state, moved)
  // The server owns the moved projects' tabs now, even ones the older build left unmovable.
  subtractMadangdMigrationScopeWorkspaceSession(state, moved)
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
