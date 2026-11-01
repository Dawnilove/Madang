import { MAX_MADANGD_MIGRATION_STAGED_CATALOGS } from '../../../shared/madangd-migration/madangd-migration-staged-catalog-validation'
import { MADANGD_MIGRATION_MANIFEST_VERSION } from '../../../shared/madangd-migration/madangd-migration-manifest-validation'
import type {
  MadangdMigrationCatalogAbortResult,
  MadangdMigrationCatalogReference,
  MadangdMigrationCatalogReferenceAbortResult,
  MadangdMigrationCatalogState,
  MadangdMigrationImportReceipt,
  MadangdMigrationManifest
} from '../../../shared/madangd-migration/madangd-migration-manifest'
import type {
  MadangdMigrationSnapshotChunkRequest,
  MadangdMigrationSnapshotChunkResult
} from '../../../shared/madangd-migration/madangd-migration-scrollback'
import type {
  MadangdMigrationBlobChunkRequest,
  MadangdMigrationBlobChunkResult,
  MadangdMigrationBlobDescriptor
} from '../../../shared/madangd-migration/madangd-migration-blob-transfer'
import type { RepoLifecycleOperations } from '../loading-store/repo-lifecycle-operations'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import type { WriteSchedulingOperations } from '../loading-store/write-scheduling'
import { scheduleSave } from '../loading-store/write-scheduling'
import {
  applyPreparedMadangdMigrationCatalog,
  assertMadangdMigrationReceiptMatchesManifest,
  assertSameMadangdMigrationManifest,
  prepareMadangdMigrationCatalog,
  type PreparedMadangdMigrationCatalog
} from './madangd-catalog-records'
import {
  expireMadangdMigrationStages,
  findMadangdMigrationImportReceipt,
  isLiveMadangdMigrationStage,
  recordMadangdMigrationCommitWriteGeneration,
  recordMadangdMigrationImportReceipt,
  type MadangdMigrationCommitGenerationRuntime
} from './madangd-catalog-receipt-ledger'
import {
  abortMadangdMigrationSnapshots,
  assertMadangdMigrationSnapshotsReady,
  commitMadangdMigrationSnapshots,
  inspectMadangdMigrationSnapshotUploads,
  pruneMadangdMigrationSnapshotStaging,
  stageMadangdMigrationSnapshotChunk
} from './madangd-scrollback-snapshot-transfer'
import {
  abortMadangdMigrationBlobs,
  assertMadangdMigrationBlobSetMatches,
  assertMadangdMigrationBlobsReady,
  commitMadangdMigrationBlobs,
  inspectMadangdMigrationBlobUploads,
  pruneMadangdMigrationBlobStaging,
  stageMadangdMigrationBlobChunk
} from './madangd-migration-blob-staging'
import { assertMadangdMigrationBlobContentsValid } from './madangd-migration-blob-installers'
import {
  abortMadangdMigrationCatalogByReference,
  committedMigrations,
  stagedManifests
} from './madangd-catalog-reference-abort'

type MadangdCatalogImportRuntime = MadangdMigrationCommitGenerationRuntime &
  Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage' | 'madangdMigrationBlobRoot'>

const madangdCatalogImportContext = Symbol('MadangdCatalogImportPersistence')
type MadangdCatalogImportContext = {
  runtime: MadangdCatalogImportRuntime
  repos: RepoLifecycleOperations
  scheduling: WriteSchedulingOperations
}

// Manifests arrive parsed; the RPC boundary verified the digest over the bytes as sent.
export class MadangdCatalogImportPersistence {
  readonly [madangdCatalogImportContext]: MadangdCatalogImportContext

  constructor(
    runtime: MadangdCatalogImportRuntime,
    repos: RepoLifecycleOperations,
    scheduling: WriteSchedulingOperations
  ) {
    this[madangdCatalogImportContext] = { runtime, repos, scheduling }
  }

  stageMadangdMigrationCatalog(
    manifest: MadangdMigrationManifest,
    options: { now?: () => Date } = {}
  ): MadangdMigrationCatalogState {
    const context = this[madangdCatalogImportContext]
    const now = options.now ?? (() => new Date())
    if (expireMadangdMigrationStages(context.runtime.state, now().getTime())) {
      scheduleSave(context.scheduling)
    }
    pruneMadangdMigrationSnapshotStaging(
      stagedManifests(context.runtime.state),
      context.runtime.terminalScrollbackSnapshotStorage
    )
    pruneMadangdMigrationBlobStaging(
      stagedManifests(context.runtime.state),
      committedMigrations(context.runtime.state),
      context.runtime.madangdMigrationBlobRoot
    )
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    prepareMadangdMigrationCatalog(manifest, context.runtime.state)
    if (current.state === 'staged') {
      return current
    }
    const staged = context.runtime.state.madangdMigrationStagedCatalogs ?? []
    if (staged.length >= MAX_MADANGD_MIGRATION_STAGED_CATALOGS) {
      throw new Error('madangd_migration_staging_capacity_exceeded')
    }
    const stagedAt = now().toISOString()
    context.runtime.state.madangdMigrationStagedCatalogs = [
      ...staged,
      {
        version: MADANGD_MIGRATION_MANIFEST_VERSION,
        manifest: structuredClone(manifest),
        stagedAt
      }
    ]
    scheduleSave(context.scheduling)
    return stagedCatalogState(manifest, stagedAt, context.runtime)
  }

  stageMadangdMigrationSnapshotChunk(
    request: MadangdMigrationSnapshotChunkRequest
  ): MadangdMigrationSnapshotChunkResult {
    const context = this[madangdCatalogImportContext]
    return stageMadangdMigrationSnapshotChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      storage: context.runtime.terminalScrollbackSnapshotStorage,
      request
    })
  }

  stageMadangdMigrationBlobChunk(
    request: MadangdMigrationBlobChunkRequest
  ): MadangdMigrationBlobChunkResult {
    const context = this[madangdCatalogImportContext]
    return stageMadangdMigrationBlobChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      root: context.runtime.madangdMigrationBlobRoot,
      request
    })
  }

  /** Omitted expectedBlobs preserves older senders' commit behavior. */
  commitStagedMadangdMigrationCatalog(
    manifest: MadangdMigrationManifest,
    options: { now?: () => Date; expectedBlobs?: readonly MadangdMigrationBlobDescriptor[] } = {}
  ): MadangdMigrationCatalogState {
    const context = this[madangdCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    if (current.state !== 'staged') {
      throw new Error('madangd_migration_catalog_not_staged')
    }
    const prepared = prepareMadangdMigrationCatalog(manifest, context.runtime.state)
    const blobRoot = context.runtime.madangdMigrationBlobRoot
    assertMadangdMigrationSnapshotsReady(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    if (options.expectedBlobs) {
      assertMadangdMigrationBlobSetMatches(manifest, blobRoot, options.expectedBlobs)
    }
    assertMadangdMigrationBlobsReady(manifest, blobRoot)
    assertMadangdMigrationBlobContentsValid(manifest, blobRoot)
    commitMadangdMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    commitMadangdMigrationBlobs(manifest, blobRoot)
    const receipt = commitPreparedCatalog(context, manifest, prepared, options.now)
    const generationBefore = context.runtime.writeGeneration
    scheduleSave(context.scheduling)
    recordMadangdMigrationCommitWriteGeneration(context.runtime, manifest, generationBefore)
    return committedCatalogState(receipt)
  }

  abortStagedMadangdMigrationCatalog(
    manifest: MadangdMigrationManifest
  ): MadangdMigrationCatalogAbortResult {
    const context = this[madangdCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed' || current.state === 'absent') {
      return { ...current, aborted: false }
    }
    // Staged rows are dormant and unreferenced outside this stage.
    context.runtime.state.madangdMigrationStagedCatalogs = (
      context.runtime.state.madangdMigrationStagedCatalogs ?? []
    ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
    abortMadangdMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    abortMadangdMigrationBlobs(manifest, context.runtime.madangdMigrationBlobRoot)
    scheduleSave(context.scheduling)
    return { ...absentCatalogState(manifest), aborted: true }
  }

  /** Use the stored manifest when the source cannot send one. */
  abortStagedMadangdMigrationCatalogByReference(
    reference: MadangdMigrationCatalogReference
  ): MadangdMigrationCatalogReferenceAbortResult {
    return abortMadangdMigrationCatalogByReference(
      this[madangdCatalogImportContext].runtime.state,
      reference,
      (manifest) => this.abortStagedMadangdMigrationCatalog(manifest)
    )
  }

  getMadangdMigrationCatalogState(manifest: MadangdMigrationManifest): MadangdMigrationCatalogState {
    const context = this[madangdCatalogImportContext]
    return migrationCatalogState(context.runtime, manifest)
  }

  hasStagedMadangdMigrationCatalog(now: number = Date.now()): boolean {
    return (this[madangdCatalogImportContext].runtime.state.madangdMigrationStagedCatalogs ?? []).some(
      (entry) => isLiveMadangdMigrationStage(entry.stagedAt, now)
    )
  }
}

function commitPreparedCatalog(
  context: MadangdCatalogImportContext,
  manifest: MadangdMigrationManifest,
  prepared: PreparedMadangdMigrationCatalog,
  now?: () => Date
): MadangdMigrationImportReceipt {
  applyPreparedMadangdMigrationCatalog(prepared, context.runtime.state, context.repos)
  const receipt: MadangdMigrationImportReceipt = {
    version: MADANGD_MIGRATION_MANIFEST_VERSION,
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    source: structuredClone(manifest.source),
    importedAt: (now ?? (() => new Date()))().toISOString(),
    repositoryIds: prepared.repositories.map((repo) => repo.id),
    projectGroupIds: prepared.projectGroups.map((group) => group.id),
    folderWorkspaceIds: prepared.folderWorkspaces.map((workspace) => workspace.id)
  }
  context.runtime.state.madangdMigrationStagedCatalogs = (
    context.runtime.state.madangdMigrationStagedCatalogs ?? []
  ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
  recordMadangdMigrationImportReceipt(context.runtime.state, receipt)
  return receipt
}

function migrationCatalogState(
  runtime: MadangdCatalogImportRuntime,
  manifest: MadangdMigrationManifest
): MadangdMigrationCatalogState {
  const { state } = runtime
  const receipt = findMadangdMigrationImportReceipt(state, manifest)
  if (receipt) {
    assertCommittedReceipt(receipt, manifest)
    return committedCatalogState(receipt)
  }
  const staged = state.madangdMigrationStagedCatalogs?.find(
    (entry) => entry.manifest.migrationId === manifest.migrationId
  )
  if (!staged) {
    return absentCatalogState(manifest)
  }
  assertSameMadangdMigrationManifest(staged.manifest, manifest)
  return stagedCatalogState(manifest, staged.stagedAt, runtime)
}

// A committed receipt stays authoritative even after live rows and snapshots change.
function assertCommittedReceipt(
  receipt: MadangdMigrationImportReceipt,
  manifest: MadangdMigrationManifest
): void {
  if (receipt.manifestSha256 !== manifest.manifestSha256) {
    throw new Error('madangd_migration_id_reused_with_different_manifest')
  }
  assertMadangdMigrationReceiptMatchesManifest(receipt, manifest)
}

function absentCatalogState(manifest: MadangdMigrationManifest): MadangdMigrationCatalogState {
  return {
    state: 'absent',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256
  }
}

function stagedCatalogState(
  manifest: MadangdMigrationManifest,
  stagedAt: string,
  runtime: MadangdCatalogImportRuntime
): MadangdMigrationCatalogState {
  const snapshotUploads = inspectMadangdMigrationSnapshotUploads(
    manifest,
    runtime.terminalScrollbackSnapshotStorage
  )
  // Omit absent uploads to preserve older hosts' response shape.
  const blobUploads = inspectMadangdMigrationBlobUploads(manifest, runtime.madangdMigrationBlobRoot)
  return {
    state: 'staged',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    stagedAt,
    ...(snapshotUploads ? { snapshotUploads } : {}),
    ...(blobUploads ? { blobUploads } : {})
  }
}

function committedCatalogState(receipt: MadangdMigrationImportReceipt): MadangdMigrationCatalogState {
  return {
    state: 'committed',
    migrationId: receipt.migrationId,
    manifestSha256: receipt.manifestSha256,
    receipt: structuredClone(receipt)
  }
}
