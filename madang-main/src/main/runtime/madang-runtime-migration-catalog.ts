import type {
  MadangdMigrationCatalogAbortResult,
  MadangdMigrationCatalogReference,
  MadangdMigrationCatalogReferenceAbortResult,
  MadangdMigrationCatalogState,
  MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'
import type {
  MadangdMigrationSnapshotChunkRequest,
  MadangdMigrationSnapshotChunkResult
} from '../../shared/madangd-migration/madangd-migration-scrollback'
import type {
  MadangdMigrationBlobChunkRequest,
  MadangdMigrationBlobChunkResult,
  MadangdMigrationBlobDescriptor
} from '../../shared/madangd-migration/madangd-migration-blob-transfer'
import {
  abortStagedMadangdMigrationCatalogByReferenceDurably,
  abortStagedMadangdMigrationCatalogDurably,
  commitStagedMadangdMigrationCatalogDurably,
  getMadangdMigrationCatalogState,
  stageMadangdMigrationCatalogDurably
} from './madangd-migration-catalog-import'
import { OrcaRuntimeWithResolveWaiter } from './madang-runtime-resolve-waiter'
import type { RuntimeStore } from './runtime-store-contract'

type MigrationStoreKey =
  | 'stageMadangdMigrationCatalog'
  | 'commitStagedMadangdMigrationCatalog'
  | 'stageMadangdMigrationSnapshotChunk'
  | 'stageMadangdMigrationBlobChunk'
  | 'abortStagedMadangdMigrationCatalog'
  | 'abortStagedMadangdMigrationCatalogByReference'
  | 'getMadangdMigrationCatalogState'
  | 'flushPendingOrThrowAsync'

/** The destination half of a dormant catalog migration; every mutation is flushed before it answers. */
export abstract class OrcaRuntimeWithMigrationCatalog extends OrcaRuntimeWithResolveWaiter {
  async stageMadangdMigrationCatalog(
    manifest: MadangdMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<MadangdMigrationCatalogState> {
    return stageMadangdMigrationCatalogDurably({
      store: this.requireMigrationStore('stageMadangdMigrationCatalog', 'flushPendingOrThrowAsync'),
      manifest,
      signal: options.signal
    })
  }

  async commitStagedMadangdMigrationCatalog(
    manifest: MadangdMigrationManifest,
    options: { signal?: AbortSignal; expectedBlobs?: readonly MadangdMigrationBlobDescriptor[] } = {}
  ): Promise<MadangdMigrationCatalogState> {
    return commitStagedMadangdMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'commitStagedMadangdMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal,
      expectedBlobs: options.expectedBlobs,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells,
      onDurableCommit: () => {
        this.invalidateResolvedWorktreeCache()
        this.notifyReposChanged()
      }
    })
  }

  stageMadangdMigrationSnapshotChunk(
    request: MadangdMigrationSnapshotChunkRequest
  ): MadangdMigrationSnapshotChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageMadangdMigrationSnapshotChunk')
      .stageMadangdMigrationSnapshotChunk!(request)
  }

  stageMadangdMigrationBlobChunk(
    request: MadangdMigrationBlobChunkRequest
  ): MadangdMigrationBlobChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageMadangdMigrationBlobChunk').stageMadangdMigrationBlobChunk!(
      request
    )
  }

  async abortStagedMadangdMigrationCatalog(
    manifest: MadangdMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<MadangdMigrationCatalogAbortResult> {
    return abortStagedMadangdMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'abortStagedMadangdMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal
    })
  }

  async abortStagedMadangdMigrationCatalogByReference(
    reference: MadangdMigrationCatalogReference,
    options: { signal?: AbortSignal } = {}
  ): Promise<MadangdMigrationCatalogReferenceAbortResult> {
    return abortStagedMadangdMigrationCatalogByReferenceDurably({
      store: this.requireMigrationStore(
        'abortStagedMadangdMigrationCatalogByReference',
        'flushPendingOrThrowAsync'
      ),
      reference,
      signal: options.signal
    })
  }

  getMadangdMigrationCatalogState(manifest: MadangdMigrationManifest): MadangdMigrationCatalogState {
    return getMadangdMigrationCatalogState({
      store: this.requireMigrationStore('getMadangdMigrationCatalogState'),
      manifest,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  /** Install deferred migrated history after host-shell discovery; unanswered inventory retries on the next catalog query. */
  async installPendingMadangdMigrationShellHistory(): Promise<void> {
    const store = this.store
    // Every daemon start calls this; no pending blobs must cost no inventory.
    if (
      !store?.installPendingMadangdMigrationReceivedBlobs ||
      !store.hasPendingMadangdMigrationShellHistory?.()
    ) {
      return
    }
    // Inventory first to find restart-surviving shells; real worktrees preserve their restored orchestration receipts.
    if (
      this.ptyController?.listProcesses &&
      !(await this.refreshPtyWorktreeRecordsWithControllerInventory([
        ...(await this.getResolvedWorktreeMap()).values()
      ]))
    ) {
      console.warn('[madangd-migration] shell history waits: the terminal inventory did not answer')
      return
    }
    store.installPendingMadangdMigrationReceivedBlobs({
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  override onPtyExit(
    ...args: Parameters<OrcaRuntimeWithResolveWaiter['onPtyExit']>
  ): ReturnType<OrcaRuntimeWithResolveWaiter['onPtyExit']> {
    const worktreeId = this.ptysById.get(args[0])?.worktreeId
    const result = super.onPtyExit(...args)
    if (worktreeId) {
      try {
        this.store?.installDeferredMadangdMigrationShellHistory?.(worktreeId, {
          worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
        })
      } catch (error) {
        console.error('[madangd-migration] installing deferred shell history failed:', error)
      }
    }
    return result
  }

  // Migrated history belongs here; same-id SSH twins never write it.
  private readonly migrationWorktreeHasLiveShells = (worktreeId: string): boolean =>
    this.getLivePtyIdsForWorktree(worktreeId, undefined, { resolvedConnectionId: null }).size > 0

  // Check the captured Store, not a potentially different virtual return.
  private requireMigrationStore(...methods: MigrationStoreKey[]): RuntimeStore {
    const store = this.store
    if (!store || methods.some((method) => typeof store[method] !== 'function')) {
      throw new Error('runtime_unavailable')
    }
    return this.requireStore()
  }
}
