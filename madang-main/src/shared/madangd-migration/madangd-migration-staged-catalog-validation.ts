import type { MadangdMigrationStagedCatalog } from './madangd-migration-manifest'
import {
  MADANGD_MIGRATION_MANIFEST_VERSION,
  parseMadangdMigrationManifest
} from './madangd-migration-manifest-validation'
import { isRecord } from './madangd-migration-manifest-fields'

export const MAX_MADANGD_MIGRATION_STAGED_CATALOGS = 4

export function normalizeMadangdMigrationStagedCatalogs(
  value: unknown
): MadangdMigrationStagedCatalog[] {
  if (!Array.isArray(value)) {
    return []
  }
  const staged: MadangdMigrationStagedCatalog[] = []
  const seen = new Set<string>()
  for (let index = value.length - 1; index >= 0; index--) {
    try {
      const entry = parseStagedCatalog(value[index])
      if (!seen.has(entry.manifest.migrationId)) {
        seen.add(entry.manifest.migrationId)
        staged.push(entry)
        if (staged.length === MAX_MADANGD_MIGRATION_STAGED_CATALOGS) {
          break
        }
      }
    } catch {
      // Invalid staging cannot prove fencing; drop it fail-closed.
    }
  }
  // Keep the migration journal runnable in the documented Node 18 rollback slot.
  return staged.reduceRight<MadangdMigrationStagedCatalog[]>((reversed, entry) => {
    reversed.push(entry)
    return reversed
  }, [])
}

function parseStagedCatalog(value: unknown): MadangdMigrationStagedCatalog {
  if (!isRecord(value) || value.version !== MADANGD_MIGRATION_MANIFEST_VERSION) {
    throw new Error('madangd_migration_staged_catalog_invalid')
  }
  const stagedAt = typeof value.stagedAt === 'string' ? value.stagedAt : ''
  if (!Number.isFinite(Date.parse(stagedAt))) {
    throw new Error('madangd_migration_staged_at_invalid')
  }
  return {
    version: MADANGD_MIGRATION_MANIFEST_VERSION,
    manifest: parseMadangdMigrationManifest(value.manifest),
    stagedAt
  }
}
