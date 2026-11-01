/** Check every blob kind against destination capabilities before uploading. Resume from staged offsets and confirm lost acknowledgements by re-reading state; never assume delivery or silently omit unsupported data. */
import {
  MADANGD_MIGRATION_BLOB_CHUNK_BYTES,
  type MadangdMigrationBlobChunkRequest,
  type MadangdMigrationBlobChunkResult,
  type MadangdMigrationBlobDescriptor,
  assertMadangdMigrationBlobSet,
  findUnsupportedMigrationBlobKind,
  madangdMigrationBlobIdentity,
  madangdMigrationBlobKindUnsupportedBlocker,
  sameMadangdMigrationBlob
} from '../../shared/madangd-migration/madangd-migration-blob-transfer'
import type {
  MadangdMigrationCatalogState,
  MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'

export type MadangdMigrationBlobSource = {
  /** Return the descriptor's exact hashed bytes at offset, up to maxBytes. */
  readChunk: (
    descriptor: MadangdMigrationBlobDescriptor,
    offset: number,
    maxBytes: number
  ) => Promise<Buffer>
}

export type MadangdMigrationBlobDestination = {
  readCapabilities: () => Promise<readonly string[]>
  readState: (manifest: MadangdMigrationManifest) => Promise<MadangdMigrationCatalogState>
  stageChunk: (request: MadangdMigrationBlobChunkRequest) => Promise<MadangdMigrationBlobChunkResult>
}

type MadangdMigrationBlobTransfer = {
  source: MadangdMigrationBlobSource
  manifest: MadangdMigrationManifest
  blobs: readonly MadangdMigrationBlobDescriptor[]
  destination: MadangdMigrationBlobDestination
}

type StagedCatalogState = Extract<MadangdMigrationCatalogState, { state: 'staged' }>

export async function transferMadangdMigrationBlobs(
  transfer: MadangdMigrationBlobTransfer
): Promise<void> {
  if (transfer.blobs.length === 0) {
    return
  }
  assertMadangdMigrationBlobSet(transfer.blobs)
  const unsupported = findUnsupportedMigrationBlobKind(
    transfer.blobs,
    await transfer.destination.readCapabilities()
  )
  if (unsupported) {
    throw new Error(madangdMigrationBlobKindUnsupportedBlocker(unsupported))
  }
  const offsets = receivedOffsets(transfer, await readStagedState(transfer))
  for (const blob of transfer.blobs) {
    let offset = offsets.get(madangdMigrationBlobIdentity(blob)) ?? 0
    while (offset < blob.byteLength) {
      const bytes = await transfer.source.readChunk(
        blob,
        offset,
        Math.min(MADANGD_MIGRATION_BLOB_CHUNK_BYTES, blob.byteLength - offset)
      )
      if (
        bytes.length === 0 ||
        bytes.length > MADANGD_MIGRATION_BLOB_CHUNK_BYTES ||
        offset + bytes.length > blob.byteLength
      ) {
        throw new Error(`madangd_migration_source_blob_changed:${blob.blobKind}`)
      }
      const request: MadangdMigrationBlobChunkRequest = {
        migrationId: transfer.manifest.migrationId,
        manifestSha256: transfer.manifest.manifestSha256,
        blob: { ...blob },
        offset,
        bytesBase64: bytes.toString('base64')
      }
      offset = await stageChunkWithRecovery(transfer, request, offset + bytes.length)
    }
  }
  assertAllReceived(transfer, await readStagedState(transfer))
}

async function readStagedState(transfer: MadangdMigrationBlobTransfer): Promise<StagedCatalogState> {
  const state = await transfer.destination.readState(transfer.manifest)
  if (state.state !== 'staged') {
    throw new Error('madangd_migration_blob_catalog_not_staged')
  }
  return state
}

function receivedOffsets(
  transfer: MadangdMigrationBlobTransfer,
  state: StagedCatalogState
): Map<string, number> {
  const wanted = new Map(transfer.blobs.map((blob) => [madangdMigrationBlobIdentity(blob), blob]))
  const offsets = new Map<string, number>()
  for (const upload of state.blobUploads ?? []) {
    const blob = wanted.get(madangdMigrationBlobIdentity(upload))
    // A reused key with different bytes is another capture; restaging would mix them.
    if (!blob || !sameMadangdMigrationBlob(blob, upload)) {
      throw new Error(`madangd_migration_blob_descriptor_conflict:${upload.blobKind}`)
    }
    offsets.set(madangdMigrationBlobIdentity(upload), upload.receivedBytes)
  }
  return offsets
}

function assertAllReceived(transfer: MadangdMigrationBlobTransfer, state: StagedCatalogState): void {
  const received = receivedOffsets(transfer, state)
  for (const blob of transfer.blobs) {
    if (received.get(madangdMigrationBlobIdentity(blob)) !== blob.byteLength) {
      throw new Error(`madangd_migration_blob_transfer_incomplete:${blob.blobKind}`)
    }
  }
}

async function stageChunkWithRecovery(
  transfer: MadangdMigrationBlobTransfer,
  request: MadangdMigrationBlobChunkRequest,
  expectedOffset: number
): Promise<number> {
  try {
    const result = await transfer.destination.stageChunk(request)
    if (result.receivedBytes !== expectedOffset) {
      throw new Error('madangd_migration_blob_ack_invalid')
    }
    return result.receivedBytes
  } catch (error) {
    try {
      const observed = await transfer.destination.readState(transfer.manifest)
      const received =
        observed.state === 'staged'
          ? observed.blobUploads?.find(
              (entry) =>
                madangdMigrationBlobIdentity(entry) === madangdMigrationBlobIdentity(request.blob)
            )?.receivedBytes
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
