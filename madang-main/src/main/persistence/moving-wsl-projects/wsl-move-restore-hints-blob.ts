import { createHash } from 'node:crypto'
import type { MadangdMigrationBlobDescriptor } from '../../../shared/madangd-migration/madangd-migration-blob-transfer'
import { sameMadangdMigrationBlob } from '../../../shared/madangd-migration/madangd-migration-blob-transfer'
import {
  MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES,
  MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
  parseMadangdMigrationTerminalRestoreHintsDocument,
  type MadangdMigrationTerminalRestoreHint
} from '../../../shared/madangd-migration/madangd-migration-terminal-restore-hints'
import type { MadangdMigrationBlobSource } from '../../ssh/madangd-migration-blob-coordinator'

export type WslMoveRestoreHintsBlob = {
  descriptor: MadangdMigrationBlobDescriptor
  bytes: Buffer
  source: MadangdMigrationBlobSource
}

/** Omit the blob when there are no hints. */
export function buildWslMoveRestoreHintsBlob(
  hints: readonly MadangdMigrationTerminalRestoreHint[]
): WslMoveRestoreHintsBlob | null {
  if (hints.length === 0) {
    return null
  }
  // Validate before staging so malformed hints fail while the source still owns the move.
  const document = parseMadangdMigrationTerminalRestoreHintsDocument({
    version: MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
    hints: hints.map((hint) => ({ paneKey: hint.paneKey, cwd: hint.cwd }))
  })
  const bytes = Buffer.from(JSON.stringify(document), 'utf8')
  if (bytes.length > MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES) {
    throw new Error('madangd_migration_terminal_restore_hints_too_large')
  }
  const descriptor: MadangdMigrationBlobDescriptor = {
    blobKind: 'terminal-restore-hints',
    key: MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
  return {
    descriptor,
    bytes,
    source: {
      readChunk: async (requested, offset, maxBytes) => {
        if (!sameMadangdMigrationBlob(requested, descriptor)) {
          throw new Error(`madangd_migration_source_blob_changed:${requested.blobKind}`)
        }
        return bytes.subarray(offset, offset + maxBytes)
      }
    }
  }
}
