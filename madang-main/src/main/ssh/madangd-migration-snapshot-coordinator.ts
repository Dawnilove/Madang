/** Read snapshot chunks from source storage and verify manifest length/digest. Resume from destination offsets; re-read after lost acknowledgements instead of assuming delivery. This transport-independent driver retires nothing. */
import type {
  MadangdMigrationCatalogState,
  MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'
import {
  decodeMadangdMigrationSnapshotChunk,
  type MadangdMigrationSnapshotChunkRequest,
  type MadangdMigrationSnapshotChunkResult
} from '../../shared/madangd-migration/madangd-migration-scrollback'
import type { Store } from '../persistence'

export type MadangdMigrationSnapshotSource = Pick<Store, 'readMadangdMigrationSourceSnapshotChunk'>

type MadangdMigrationSnapshotDestination = {
  readState: (manifest: MadangdMigrationManifest) => Promise<MadangdMigrationCatalogState>
  stageChunk: (
    request: MadangdMigrationSnapshotChunkRequest
  ) => Promise<MadangdMigrationSnapshotChunkResult>
}

export async function transferMadangdMigrationSnapshots(args: {
  source: MadangdMigrationSnapshotSource
  manifest: MadangdMigrationManifest
  state: Extract<MadangdMigrationCatalogState, { state: 'staged' }>
  destination: MadangdMigrationSnapshotDestination
}): Promise<void> {
  const snapshots = args.manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  if (snapshots.length === 0) {
    return
  }
  // Journal retention keeps bytes available after tab close, including retries.
  await sendSnapshots(args, snapshots)
}

async function sendSnapshots(
  args: Parameters<typeof transferMadangdMigrationSnapshots>[0],
  snapshots: NonNullable<
    NonNullable<MadangdMigrationManifest['payload']['dormantState']>['terminalScrollbackSnapshots']
  >
): Promise<void> {
  const offsets = new Map(
    (args.state.snapshotUploads ?? []).map((entry) => [entry.ref, entry.receivedBytes])
  )
  for (const snapshot of snapshots) {
    let offset = offsets.get(snapshot.ref)
    if (offset === undefined) {
      throw new Error('madangd_migration_snapshot_transfer_unsupported')
    }
    while (offset < snapshot.byteLength) {
      const chunk = args.source.readMadangdMigrationSourceSnapshotChunk(
        args.manifest,
        snapshot.ref,
        offset
      )
      if (chunk.totalBytes !== snapshot.byteLength || !chunk.bytesBase64) {
        throw new Error('madangd_migration_source_snapshot_changed')
      }
      const request: MadangdMigrationSnapshotChunkRequest = {
        migrationId: args.manifest.migrationId,
        manifestSha256: args.manifest.manifestSha256,
        ref: snapshot.ref,
        offset,
        bytesBase64: chunk.bytesBase64
      }
      const expectedOffset = offset + decodeMadangdMigrationSnapshotChunk(chunk.bytesBase64).length
      offset = await stageChunkWithRecovery(args, request, expectedOffset)
    }
  }
  const verified = await args.destination.readState(args.manifest)
  if (
    verified.state !== 'staged' ||
    (verified.snapshotUploads ?? []).length !== snapshots.length ||
    (verified.snapshotUploads ?? []).some((entry) => entry.receivedBytes !== entry.byteLength)
  ) {
    throw new Error('madangd_migration_snapshot_transfer_incomplete')
  }
}

async function stageChunkWithRecovery(
  args: { manifest: MadangdMigrationManifest; destination: MadangdMigrationSnapshotDestination },
  request: MadangdMigrationSnapshotChunkRequest,
  expectedOffset: number
): Promise<number> {
  try {
    const result = await args.destination.stageChunk(request)
    if (result.acknowledgedOffset !== expectedOffset) {
      throw new Error('madangd_migration_snapshot_ack_invalid')
    }
    return result.acknowledgedOffset
  } catch (error) {
    try {
      const observed = await args.destination.readState(args.manifest)
      const received =
        observed.state === 'staged'
          ? observed.snapshotUploads?.find((entry) => entry.ref === request.ref)?.receivedBytes
          : undefined
      if (received === expectedOffset) {
        return received
      }
    } catch {
      // Unverifiable chunks retain the original failure.
    }
    throw error
  }
}
