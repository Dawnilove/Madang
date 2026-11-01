import type {
  MadangdMigrationCatalogAbortResult,
  MadangdMigrationCatalogReference,
  MadangdMigrationCatalogReferenceAbortResult,
  MadangdMigrationCatalogState,
  MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'
import type { MadangdMigrationBlobDescriptor } from '../../shared/madangd-migration/madangd-migration-blob-transfer'
import type { Store } from '../persistence'

/** A moved history waits while a shell runs in its worktree: that shell would overwrite it. */
type WorktreeHasLiveShells = (worktreeId: string) => boolean

type MadangdMigrationCatalogFlushStore = Partial<Pick<Store, 'flushPendingOrThrowAsync'>>
type MadangdMigrationCatalogStageStore = MadangdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'stageMadangdMigrationCatalog'>>
type MadangdMigrationCatalogCommitStore = MadangdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'commitStagedMadangdMigrationCatalog' | 'installMadangdMigrationReceivedBlobs'>>
type MadangdMigrationCatalogAbortStore = MadangdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedMadangdMigrationCatalog'>>
type MadangdMigrationCatalogAbortByReferenceStore = MadangdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedMadangdMigrationCatalogByReference'>>

export async function stageMadangdMigrationCatalogDurably(args: {
  store: MadangdMigrationCatalogStageStore
  manifest: MadangdMigrationManifest
  signal?: AbortSignal
}): Promise<MadangdMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.stageMadangdMigrationCatalog!(args.manifest)
  await flushMigrationState(args.store, args.signal)
  return result
}

export async function commitStagedMadangdMigrationCatalogDurably(args: {
  store: MadangdMigrationCatalogCommitStore
  manifest: MadangdMigrationManifest
  signal?: AbortSignal
  expectedBlobs?: readonly MadangdMigrationBlobDescriptor[]
  onDurableCommit: () => void
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): Promise<MadangdMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.commitStagedMadangdMigrationCatalog!(
    args.manifest,
    args.expectedBlobs ? { expectedBlobs: args.expectedBlobs } : {}
  )
  await flushMigrationState(args.store, args.signal)
  args.onDurableCommit()
  installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  return result
}

/** After the durable commit, on its retries and state queries; the store load retries too. */
function installReceivedBlobs(
  store: Partial<Pick<Store, 'installMadangdMigrationReceivedBlobs'>>,
  manifest: MadangdMigrationManifest,
  worktreeHasLiveShells: WorktreeHasLiveShells | undefined
): void {
  try {
    store.installMadangdMigrationReceivedBlobs?.(manifest, { worktreeHasLiveShells })
  } catch (error) {
    // The catalog is committed; a failed install keeps its blob for the next retry.
    console.error('[madangd-migration] installing received blobs failed:', error)
  }
}

export async function abortStagedMadangdMigrationCatalogDurably(args: {
  store: MadangdMigrationCatalogAbortStore
  manifest: MadangdMigrationManifest
  signal?: AbortSignal
}): Promise<MadangdMigrationCatalogAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedMadangdMigrationCatalog!(args.manifest)
  // An already-absent retry may follow an in-memory abort whose flush failed.
  if (result.state === 'absent') {
    await flushMigrationState(args.store, args.signal)
    return { ...result, durableAbsent: true }
  }
  return result
}

export async function abortStagedMadangdMigrationCatalogByReferenceDurably(args: {
  store: MadangdMigrationCatalogAbortByReferenceStore
  reference: MadangdMigrationCatalogReference
  signal?: AbortSignal
}): Promise<MadangdMigrationCatalogReferenceAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedMadangdMigrationCatalogByReference!(args.reference)
  if (result.state === 'absent') {
    await flushMigrationState(args.store, args.signal)
    return { ...result, durableAbsent: true }
  }
  return result
}

export function getMadangdMigrationCatalogState(args: {
  store: Partial<
    Pick<Store, 'getMadangdMigrationCatalogState' | 'installMadangdMigrationReceivedBlobs'>
  >
  manifest: MadangdMigrationManifest
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): MadangdMigrationCatalogState {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.getMadangdMigrationCatalogState!(args.manifest)
  if (result.state === 'committed') {
    installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  }
  return result
}

function flushMigrationState(
  store: MadangdMigrationCatalogFlushStore,
  signal?: AbortSignal
): Promise<void> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  return store.flushPendingOrThrowAsync!({
    signal,
    drainToStableGeneration: false
  })
}
