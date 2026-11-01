/** Keep source authority until durable destination commit. Verify the fenced export before stage/commit; resolve lost replies by catalog reads and persist journal transitions before returning. Never release a committed destination. */
import type {
  MadangdMigrationCatalogAbortResult,
  MadangdMigrationCatalogReferenceAbortResult,
  MadangdMigrationCatalogState,
  MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'
import type {
  MadangdMigrationSnapshotChunkRequest,
  MadangdMigrationSnapshotChunkResult
} from '../../shared/madangd-migration/madangd-migration-scrollback'
import type {
  MadangdMigrationSourceCutover,
  MadangdMigrationSourceCutoverPhase
} from '../../shared/madangd-migration/madangd-migration-source-cutover'
import { resolveDurableMadangdCatalogMutation } from './madangd-catalog-durable-mutation'
import { MADANGD_MIGRATION_DESTINATION_UNSUPPORTED } from './madangd-migration-catalog-client'
import { madangdMigrationRequestFits } from './madangd-migration-manifest-export'
import {
  listMadangdMigrationSourceCutovers,
  writeMadangdMigrationSourceCutover
} from './madangd-migration-cutover-journal'
import type { MadangdMigrationSourceCutoverPort } from './madangd-migration-source'
import {
  transferMadangdMigrationSnapshots,
  type MadangdMigrationSnapshotSource
} from './madangd-migration-snapshot-coordinator'
import type { MadangdMigrationPreflightStore } from './targets/ssh-target-madangd-preflight'
import { sshRelayMigrationCutoverPort } from './madangd-migration-ssh-relay-source'
import type { SshTargetMadangdClaims } from './targets/ssh-target-madangd-claims'

export type MadangdMigrationDestinationCatalog = {
  readState: (manifest: MadangdMigrationManifest) => Promise<MadangdMigrationCatalogState>
  stage: (manifest: MadangdMigrationManifest) => Promise<MadangdMigrationCatalogState>
  commit: (manifest: MadangdMigrationManifest) => Promise<MadangdMigrationCatalogState>
  abort: (manifest: MadangdMigrationManifest) => Promise<MadangdMigrationCatalogAbortResult>
  /** Use identity-only abort when the journal's full manifest cannot fit a request. */
  abortByReference: (
    manifest: MadangdMigrationManifest
  ) => Promise<MadangdMigrationCatalogReferenceAbortResult>
  stageChunk: (
    request: MadangdMigrationSnapshotChunkRequest
  ) => Promise<MadangdMigrationSnapshotChunkResult>
}

export type MadangdMigrationCutoverContext = {
  userDataPath: string
  store: MadangdMigrationPreflightStore & MadangdMigrationSnapshotSource
  claims: SshTargetMadangdClaims
  destination: MadangdMigrationDestinationCatalog
  /** Rebuild copied stores for each check so concurrent edits remain visible. */
  freshSource?: () => MadangdMigrationPreflightStore
  /** The fenced source; defaults to the relay-era SSH target the journal names. */
  source?: MadangdMigrationSourceCutoverPort
  now?: () => Date
}

function cutoverSource(context: MadangdMigrationCutoverContext): MadangdMigrationSourceCutoverPort {
  return context.source ?? sshRelayMigrationCutoverPort(context)
}

export async function stageMadangdMigrationDestination(
  context: MadangdMigrationCutoverContext,
  migrationId: string
): Promise<MadangdMigrationSourceCutover> {
  let cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return cutover
  }
  assertSourceUnchanged(context, cutover)
  const { destination } = context
  const read = await destination.readState(cutover.manifest)
  const state =
    read.state === 'committed'
      ? await confirmDurableCommit(destination, cutover.manifest)
      : await resolveDurableMadangdCatalogMutation(
          () => destination.stage(cutover.manifest),
          () => destination.readState(cutover.manifest),
          (observed) => observed.state !== 'absent'
        )
  cutover = recordObservedState(context, cutover, state)
  if (state.state === 'staged') {
    await transferMadangdMigrationSnapshots({
      source: context.store,
      manifest: cutover.manifest,
      state,
      destination: { readState: destination.readState, stageChunk: destination.stageChunk }
    })
  }
  return cutover
}

export async function commitMadangdMigrationDestination(
  context: MadangdMigrationCutoverContext,
  migrationId: string
): Promise<MadangdMigrationSourceCutover> {
  const staged = await stageMadangdMigrationDestination(context, migrationId)
  if (staged.phase !== 'destination-staged') {
    return staged
  }
  assertSourceUnchanged(context, staged)
  const { destination } = context
  // A lost commit reply may hide success; catalog read decides the next step.
  const state = await resolveDurableMadangdCatalogMutation(
    () => destination.commit(staged.manifest),
    () => destination.readState(staged.manifest),
    (observed) => observed.state === 'committed'
  )
  if (state.state !== 'committed') {
    throw new Error(`madangd_migration_commit_not_committed:${state.state}`)
  }
  return recordObservedState(context, staged, state)
}

export type MadangdMigrationAbortResult =
  | { outcome: 'released'; evidence: 'catalog-absent' | 'destination-unsupported' }
  | { outcome: 'refused'; code: string; reason: string }

/** Release only on proven destination absence; default drops journal/fence, while delta moves retain the fence. */
export async function abortMadangdMigrationCutover(
  context: MadangdMigrationCutoverContext,
  migrationId: string,
  release: (cutover: MadangdMigrationSourceCutover) => Promise<void> = (cutover) =>
    cutoverSource(context).releaseFence(cutover)
): Promise<MadangdMigrationAbortResult> {
  const cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return committedRefusal()
  }
  const { destination } = context
  // Older journals can hold oversized manifests; identity-only abort must still release them.
  if (!madangdMigrationRequestFits({ manifest: cutover.manifest })) {
    const aborted = await destination.abortByReference(cutover.manifest)
    if (aborted.state === 'committed') {
      return committedRefusal()
    }
    await release(cutover)
    return { outcome: 'released', evidence: 'catalog-absent' }
  }
  let state: MadangdMigrationCatalogState
  try {
    state = await destination.readState(cutover.manifest)
  } catch (error) {
    // Unsupported proves absence only before any stage could have landed.
    if (isDestinationUnsupported(error) && cutover.phase === 'source-fenced') {
      await release(cutover)
      return { outcome: 'released', evidence: 'destination-unsupported' }
    }
    throw error
  }
  if (state.state !== 'committed') {
    state = await abortWithRecovery(destination, cutover.manifest)
  }
  if (state.state === 'committed') {
    recordObservedState(context, cutover, await confirmDurableCommit(destination, cutover.manifest))
    return committedRefusal()
  }
  if (state.state !== 'absent') {
    throw new Error(`madangd_migration_abort_not_absent:${state.state}`)
  }
  await release(cutover)
  return { outcome: 'released', evidence: 'catalog-absent' }
}

/** Committed reads may be unflushed memory; require the idempotent commit acknowledgement to prove durability. */
async function confirmDurableCommit(
  destination: MadangdMigrationDestinationCatalog,
  manifest: MadangdMigrationManifest
): Promise<MadangdMigrationCatalogState> {
  const state = await destination.commit(manifest)
  if (state.state !== 'committed') {
    throw new Error(`madangd_migration_commit_not_committed:${state.state}`)
  }
  return state
}

function assertSourceUnchanged(
  context: MadangdMigrationCutoverContext,
  cutover: MadangdMigrationSourceCutover
): void {
  cutoverSource(context).verifyFence(cutover)
}

/** Persist observed state before returning. */
function recordObservedState(
  context: MadangdMigrationCutoverContext,
  cutover: MadangdMigrationSourceCutover,
  state: MadangdMigrationCatalogState
): MadangdMigrationSourceCutover {
  if (state.state === 'absent') {
    throw new Error('madangd_migration_destination_catalog_absent')
  }
  if (
    state.migrationId !== cutover.migrationId ||
    state.manifestSha256 !== cutover.manifestSha256
  ) {
    throw new Error('madangd_migration_destination_state_mismatch')
  }
  if (
    state.state === 'committed' &&
    (state.receipt.migrationId !== cutover.migrationId ||
      state.receipt.manifestSha256 !== cutover.manifestSha256)
  ) {
    throw new Error('madangd_migration_destination_receipt_mismatch')
  }
  const phase: MadangdMigrationSourceCutoverPhase =
    state.state === 'committed' ? 'destination-committed' : 'destination-staged'
  if (phase === cutover.phase) {
    return cutover
  }
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    // Never regress a proven commit.
    return cutover
  }
  const next: MadangdMigrationSourceCutover = {
    ...cutover,
    phase,
    updatedAt: (context.now ?? (() => new Date()))().toISOString()
  }
  writeMadangdMigrationSourceCutover(context.userDataPath, next)
  return next
}

async function abortWithRecovery(
  destination: MadangdMigrationDestinationCatalog,
  manifest: MadangdMigrationManifest
): Promise<MadangdMigrationCatalogState> {
  try {
    return await destination.abort(manifest)
  } catch (abortError) {
    try {
      const observed = await destination.readState(manifest)
      if (observed.state === 'committed') {
        return observed
      }
      if (observed.state === 'absent') {
        // Absent reads may predate flush; repeat abort to prove durable absence.
        return await destination.abort(manifest)
      }
    } catch {
      // Keep the original failure and fence while abort remains unverifiable.
    }
    throw abortError
  }
}

function requireCutover(userDataPath: string, migrationId: string): MadangdMigrationSourceCutover {
  const cutover = listMadangdMigrationSourceCutovers(userDataPath).find(
    (entry) => entry.migrationId === migrationId
  )
  if (!cutover) {
    throw new Error('madangd_migration_source_cutover_not_found')
  }
  return cutover
}

function committedRefusal(): MadangdMigrationAbortResult {
  return {
    outcome: 'refused',
    code: 'madangd_migration_committed_source_cannot_be_released',
    reason: 'This host’s Madang server already holds this migration; it can only move forward.'
  }
}

function isDestinationUnsupported(error: unknown): boolean {
  return error instanceof Error && error.message === MADANGD_MIGRATION_DESTINATION_UNSUPPORTED
}
