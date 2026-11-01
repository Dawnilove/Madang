import type { FolderWorkspace } from '../folder-workspace-types'
import type { Automation, AutomationRun } from '../automations-types'
import type { MadangdMigrationManifestVersion } from './madangd-migration-manifest-validation'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'
import type { SparsePreset } from '../worktree/create-types'
import type { WorkspaceLineage, WorktreeLineage } from '../worktree/lineage-types'
import type { WorktreeMeta } from '../worktree/meta-types'
import type { RetiredNameRegistry } from '../worktree/retired-name-registry'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import type { MadangdMigrationClientStatePayload } from './madangd-migration-client-state'
import type {
  MadangdMigrationSnapshotUploadState,
  MadangdMigrationTerminalScrollbackSnapshot
} from './madangd-migration-scrollback'
import type { MadangdMigrationBlobUploadState } from './madangd-migration-blob-transfer'

import { isRecord } from './madangd-migration-manifest-fields'

/** The relay-era SSH source: on the wire it never carries `kind` (see madangd-migration-source-kind). */
export type MadangdMigrationSshManifestSource = {
  sshTargetId: string
  sshTargetGeneration: number | null
  targetLabel: string
}

/** Explicit desktop WSL project scope prevents destination path inference; generation orders delta moves. */
export type MadangdMigrationLocalWslManifestSource = {
  kind: 'local-wsl'
  distro: string
  /** The distro's registry id, when known: a re-registered distro of the same name is another one. */
  distroGuid?: string
  scopeRepoIds: string[]
  scopeFolderWorkspaceIds: string[]
  generation: number
}

export type MadangdMigrationManifestSource =
  | MadangdMigrationSshManifestSource
  | MadangdMigrationLocalWslManifestSource

export type MadangdMigrationCatalogPayload = {
  repositories: Repo[]
  projectGroups: ProjectGroup[]
  folderWorkspaces: FolderWorkspace[]
  dormantState?: MadangdMigrationDormantStatePayload
}

export type MadangdMigrationDormantWorktreeMeta = {
  sourceKey: string
  worktreeId: string
  meta: WorktreeMeta
}

export type MadangdMigrationDormantWorktreeLineage = {
  sourceKey: string
  worktreeId: string
  lineage: WorktreeLineage
}

export type MadangdMigrationDormantWorkspaceLineage = {
  sourceKey: string
  childWorkspaceKey: string
  lineage: WorkspaceLineage
}

export type MadangdMigrationDormantRetiredNames = {
  repoId: string
  registry: RetiredNameRegistry
}

export type MadangdMigrationDormantRetirementNamespace = {
  sourceNamespaceKeys: string[]
  namespaceKey: string
  registry: RetiredNameRegistry
}

export type MadangdMigrationDormantStatePayload = {
  version: 1
  worktreeMeta: MadangdMigrationDormantWorktreeMeta[]
  worktreeLineage: MadangdMigrationDormantWorktreeLineage[]
  workspaceLineage: MadangdMigrationDormantWorkspaceLineage[]
  sparsePresets: SparsePreset[]
  retiredWorktreeNames: MadangdMigrationDormantRetiredNames[]
  retiredWorktreeNamespaces: MadangdMigrationDormantRetirementNamespace[]
  workspaceSession?: WorkspaceSessionState
  terminalScrollbackSnapshots?: MadangdMigrationTerminalScrollbackSnapshot[]
  automations?: Automation[]
  automationRuns?: AutomationRun[]
  /** Client-owned durable intent projected to the destination authority. */
  clientState?: MadangdMigrationClientStatePayload
}

export type MadangdMigrationManifest = {
  version: MadangdMigrationManifestVersion
  migrationId: string
  createdAt: string
  source: MadangdMigrationManifestSource
  payload: MadangdMigrationCatalogPayload
  /** Destination runtime identity used to re-key desktop routing after commit. */
  destinationEnvironmentId?: string
  manifestSha256: string
}

export type MadangdMigrationImportReceipt = {
  version: MadangdMigrationManifestVersion
  migrationId: string
  manifestSha256: string
  source: MadangdMigrationManifestSource
  importedAt: string
  repositoryIds: string[]
  projectGroupIds: string[]
  folderWorkspaceIds: string[]
}

export type MadangdMigrationStagedCatalog = {
  version: MadangdMigrationManifestVersion
  manifest: MadangdMigrationManifest
  stagedAt: string
}

export type MadangdMigrationCatalogState =
  | {
      state: 'absent'
      migrationId: string
      manifestSha256: string
    }
  | {
      state: 'staged'
      migrationId: string
      manifestSha256: string
      stagedAt: string
      snapshotUploads?: MadangdMigrationSnapshotUploadState[]
      /** Blobs staged so far; absent from hosts without the blob channel. */
      blobUploads?: MadangdMigrationBlobUploadState[]
    }
  | {
      state: 'committed'
      migrationId: string
      manifestSha256: string
      receipt: MadangdMigrationImportReceipt
    }

export type MadangdMigrationCatalogAbortResult = MadangdMigrationCatalogState & {
  aborted: boolean
  durableAbsent?: true
}

export type MadangdMigrationCatalogReference = Pick<
  MadangdMigrationManifest,
  'migrationId' | 'manifestSha256'
>

/** An abort by reference: no receipt, since an evicted one is rebuilt only from the manifest. */
export type MadangdMigrationCatalogReferenceAbortResult = MadangdMigrationCatalogReference & {
  state: 'absent' | 'committed'
  aborted: boolean
  durableAbsent?: true
}

export function madangdMigrationManifestHashInput(
  manifest: Omit<MadangdMigrationManifest, 'manifestSha256'>
): string {
  return serializeMadangdMigrationValue(manifest)
}

export function serializeMadangdMigrationValue(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value))
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalizeJsonValue(entry)])
  )
}
