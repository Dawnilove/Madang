import { normalizeMadangdMigrationImportReceipts } from './madangd-migration-manifest-validation'
import type {
  MadangdMigrationCatalogAbortResult,
  MadangdMigrationCatalogReferenceAbortResult,
  MadangdMigrationCatalogState,
  MadangdMigrationManifest
} from './madangd-migration-manifest'
import { parseMadangdMigrationSnapshotUploadStates } from './madangd-migration-scrollback'
import { parseMadangdMigrationBlobUploadStates } from './madangd-migration-blob-transfer'
import { isRecord } from './madangd-migration-manifest-fields'

export function parseMadangdMigrationCatalogState(
  value: unknown,
  manifest: MadangdMigrationManifest
): MadangdMigrationCatalogState {
  const record = requireRecord(value)
  if (
    record.migrationId !== manifest.migrationId ||
    record.manifestSha256 !== manifest.manifestSha256
  ) {
    throw new Error('madangd_migration_catalog_state_identity_mismatch')
  }
  if (record.state === 'absent') {
    return { state: 'absent', ...migrationIdentity(manifest) }
  }
  if (record.state === 'staged') {
    const stagedAt = requireDate(record.stagedAt)
    const snapshotUploads = parseMadangdMigrationSnapshotUploadStates(
      record.snapshotUploads,
      manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
    )
    const blobUploads = parseMadangdMigrationBlobUploadStates(record.blobUploads)
    return {
      state: 'staged',
      ...migrationIdentity(manifest),
      stagedAt,
      ...(snapshotUploads ? { snapshotUploads } : {}),
      ...(blobUploads ? { blobUploads } : {})
    }
  }
  if (record.state === 'committed') {
    const receipt = normalizeMadangdMigrationImportReceipts([record.receipt])[0]
    if (
      !receipt ||
      receipt.migrationId !== manifest.migrationId ||
      receipt.manifestSha256 !== manifest.manifestSha256
    ) {
      throw new Error('madangd_migration_catalog_state_receipt_invalid')
    }
    return { state: 'committed', ...migrationIdentity(manifest), receipt }
  }
  // No known arm is safe to assume for a newer host's state; stop with an actionable reason.
  if (typeof record.state === 'string') {
    throw new Error('madangd_migration_catalog_state_unsupported:client_update_required')
  }
  throw new Error('madangd_migration_catalog_state_invalid')
}

export function parseMadangdMigrationCatalogAbortResult(
  value: unknown,
  manifest: MadangdMigrationManifest
): MadangdMigrationCatalogAbortResult {
  const state = parseMadangdMigrationCatalogState(value, manifest)
  const record = requireRecord(value)
  if (typeof record.aborted !== 'boolean') {
    throw new Error('madangd_migration_catalog_abort_result_invalid')
  }
  if (
    record.durableAbsent !== undefined &&
    (record.durableAbsent !== true || state.state !== 'absent')
  ) {
    throw new Error('madangd_migration_catalog_abort_durability_invalid')
  }
  return {
    ...state,
    aborted: record.aborted,
    ...(record.durableAbsent === true ? { durableAbsent: true as const } : {})
  }
}

/** Absent only with the host's flush behind it: an unflushed abort could come back on restart. */
export function parseMadangdMigrationCatalogReferenceAbortResult(
  value: unknown,
  manifest: MadangdMigrationManifest
): MadangdMigrationCatalogReferenceAbortResult {
  const record = requireRecord(value)
  if (
    record.migrationId !== manifest.migrationId ||
    record.manifestSha256 !== manifest.manifestSha256
  ) {
    throw new Error('madangd_migration_catalog_state_identity_mismatch')
  }
  if (typeof record.aborted !== 'boolean') {
    throw new Error('madangd_migration_catalog_abort_result_invalid')
  }
  if (record.state === 'committed') {
    return { state: 'committed', ...migrationIdentity(manifest), aborted: false }
  }
  if (record.state === 'absent' && record.durableAbsent === true) {
    return {
      state: 'absent',
      ...migrationIdentity(manifest),
      aborted: record.aborted,
      durableAbsent: true
    }
  }
  throw new Error('madangd_migration_catalog_abort_durability_invalid')
}

function migrationIdentity(manifest: MadangdMigrationManifest) {
  return { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('madangd_migration_catalog_state_invalid')
  }
  return value
}

function requireDate(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('madangd_migration_catalog_state_staged_at_invalid')
  }
  return value
}
