// Commit receipts remain authoritative indefinitely; abandoned stages expire.
import { MAX_MADANGD_MIGRATION_IMPORT_RECEIPTS } from '../../../shared/madangd-migration/madangd-migration-manifest-validation'
import type {
  MadangdMigrationImportReceipt,
  MadangdMigrationManifest
} from '../../../shared/madangd-migration/madangd-migration-manifest'
import { MAX_MADANGD_MIGRATION_EVICTED_RECEIPTS } from '../../../shared/madangd-migration/madangd-migration-evicted-receipts'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  madangdMigrationStagingKey,
  type MadangdMigrationRequestIdentity
} from './madangd-migration-staged-file'

// Allow a week for clients that went offline mid-move.
export const MADANGD_MIGRATION_STAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function findMadangdMigrationImportReceipt(
  state: PersistedState,
  manifest: MadangdMigrationManifest
): MadangdMigrationImportReceipt | undefined {
  const receipt = state.madangdMigrationImportReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  if (receipt) {
    return receipt
  }
  const evicted = state.madangdMigrationEvictedReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  // Rebuild the remaining receipt fields from the manifest.
  return evicted
    ? {
        version: manifest.version,
        migrationId: evicted.migrationId,
        manifestSha256: evicted.manifestSha256,
        source: structuredClone(manifest.source),
        importedAt: evicted.importedAt,
        repositoryIds: manifest.payload.repositories.map((repo) => repo.id),
        projectGroupIds: manifest.payload.projectGroups.map((group) => group.id),
        folderWorkspaceIds: manifest.payload.folderWorkspaces.map((workspace) => workspace.id)
      }
    : undefined
}

/** Compact evicted receipts without losing proof of commit. */
export function recordMadangdMigrationImportReceipt(
  state: PersistedState,
  receipt: MadangdMigrationImportReceipt
): void {
  const receipts = [...(state.madangdMigrationImportReceipts ?? []), receipt]
  const overflow = receipts.length - MAX_MADANGD_MIGRATION_IMPORT_RECEIPTS
  if (overflow > 0) {
    state.madangdMigrationEvictedReceipts = [
      ...(state.madangdMigrationEvictedReceipts ?? []),
      ...receipts.slice(0, overflow).map(({ migrationId, manifestSha256, importedAt }) => ({
        migrationId,
        manifestSha256,
        importedAt
      }))
    ].slice(-MAX_MADANGD_MIGRATION_EVICTED_RECEIPTS)
  }
  state.madangdMigrationImportReceipts = receipts.slice(-MAX_MADANGD_MIGRATION_IMPORT_RECEIPTS)
}

export function isLiveMadangdMigrationStage(stagedAt: string, now: number): boolean {
  return now - Date.parse(stagedAt) < MADANGD_MIGRATION_STAGE_TTL_MS
}

export function expireMadangdMigrationStages(state: PersistedState, now: number): boolean {
  const staged = state.madangdMigrationStagedCatalogs ?? []
  const live = staged.filter((entry) => isLiveMadangdMigrationStage(entry.stagedAt, now))
  if (live.length === staged.length) {
    return false
  }
  state.madangdMigrationStagedCatalogs = live
  return true
}

export type MadangdMigrationCommitGenerationRuntime = Pick<
  StoreRuntimeState,
  'writeGeneration' | 'lastDurableWriteGeneration' | 'madangdMigrationCommitWriteGenerations'
>

/** Call right after the commit's `scheduleSave`; `generationBefore` is read just before it. */
export function recordMadangdMigrationCommitWriteGeneration(
  runtime: MadangdMigrationCommitGenerationRuntime,
  migration: MadangdMigrationRequestIdentity,
  generationBefore: number
): void {
  // Suppressed saves never advance generation; only a disk-loaded receipt can prove durability.
  runtime.madangdMigrationCommitWriteGenerations.set(
    madangdMigrationStagingKey(migration),
    runtime.writeGeneration > generationBefore ? runtime.writeGeneration : Number.POSITIVE_INFINITY
  )
}

/** Require disk durability before consuming blobs a restart might need to retry. */
export function isMadangdMigrationCommitDurable(
  runtime: MadangdMigrationCommitGenerationRuntime,
  migration: MadangdMigrationRequestIdentity
): boolean {
  const key = madangdMigrationStagingKey(migration)
  const required = runtime.madangdMigrationCommitWriteGenerations.get(key)
  if (required === undefined) {
    return true
  }
  if (runtime.lastDurableWriteGeneration < required) {
    return false
  }
  runtime.madangdMigrationCommitWriteGenerations.delete(key)
  return true
}
