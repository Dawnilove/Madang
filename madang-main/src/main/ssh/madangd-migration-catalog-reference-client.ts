import { parseMadangdMigrationCatalogReferenceAbortResult } from '../../shared/madangd-migration/madangd-migration-catalog-state'
import type {
  MadangdMigrationCatalogReferenceAbortResult,
  MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'
import { MADANGD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY } from '../../shared/madangd-runtime-capabilities'
import { parsePairingCode } from '../../shared/pairing'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import {
  MADANGD_MIGRATION_DESTINATION_UNSUPPORTED,
  sendSupportedMigrationRequest,
  type CatalogRequestOptions
} from './madangd-migration-catalog-client'

/** Unlike migration-unsupported, this refusal cannot prove no earlier stage exists. */
export const MADANGD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED =
  'madangd_migration_destination_abort_by_reference_unsupported:Update Madang on this host to cancel this move.'

/** Abort by manifest identity when the full request cannot fit the sealed frame. */
export async function abortRemoteMadangdMigrationCatalogByReference(
  pairingCode: string,
  manifest: MadangdMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<MadangdMigrationCatalogReferenceAbortResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('madangd_migration_pairing_code_invalid')
  }
  let supportsReference = false
  let response: RuntimeRpcResponse<unknown>
  try {
    response = await sendSupportedMigrationRequest(
      pairing,
      'madangd.migration.abortCatalogByReference',
      { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 },
      options,
      false,
      null,
      (capabilities) => {
        supportsReference = capabilities.includes(
          MADANGD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY
        )
        if (!supportsReference) {
          throw new Error(MADANGD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
        }
      }
    )
  } catch (error) {
    // A missing method on a host that advertised it proves nothing about what it staged.
    if (
      supportsReference &&
      error instanceof Error &&
      error.message === MADANGD_MIGRATION_DESTINATION_UNSUPPORTED
    ) {
      throw new Error(MADANGD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`madangd_migration_abort_failed:${response.error.message}`)
  }
  return parseMadangdMigrationCatalogReferenceAbortResult(response.result, manifest)
}
