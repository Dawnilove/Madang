import { createHash } from 'node:crypto'
import {
  madangdMigrationManifestHashInput,
  serializeMadangdMigrationValue,
  type MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'

export function computeMadangdMigrationManifestSha256(
  manifest: Omit<MadangdMigrationManifest, 'manifestSha256'>
): string {
  return createHash('sha256').update(madangdMigrationManifestHashInput(manifest)).digest('hex')
}

/** Hash the received manifest: unknown fields from newer peers are part of its signature. */
export function assertMadangdMigrationManifestDigest(manifest: unknown): void {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('madangd_migration_manifest_invalid')
  }
  const unsigned = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== 'manifestSha256')
  )
  const digest = createHash('sha256').update(serializeMadangdMigrationValue(unsigned)).digest('hex')
  if (!('manifestSha256' in manifest) || digest !== manifest.manifestSha256) {
    throw new Error('madangd_migration_manifest_digest_mismatch')
  }
}
