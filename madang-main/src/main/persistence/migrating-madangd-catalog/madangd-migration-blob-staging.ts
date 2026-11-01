// The manifest omits blobs; descriptor filenames make staged uploads resumable after restart.
import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  MADANGD_MIGRATION_BLOB_KINDS,
  assertMadangdMigrationBlobSet,
  decodeMadangdMigrationBlobChunk,
  madangdMigrationBlobIdentity,
  parseMadangdMigrationBlobDescriptor,
  sameMadangdMigrationBlob,
  type MadangdMigrationBlobChunkRequest,
  type MadangdMigrationBlobChunkResult,
  type MadangdMigrationBlobDescriptor,
  type MadangdMigrationBlobKind,
  type MadangdMigrationBlobUploadState
} from '../../../shared/madangd-migration/madangd-migration-blob-transfer'
import type { MadangdMigrationManifest } from '../../../shared/madangd-migration/madangd-migration-manifest'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  appendMadangdMigrationStagedChunk,
  ensureMadangdMigrationDirectory,
  inspectMadangdMigrationFinalFile,
  linkMadangdMigrationStagedFile,
  madangdMigrationFileMatches,
  madangdMigrationStagedFileSize,
  madangdMigrationStagingDirectory,
  madangdMigrationStagingKey,
  pruneMadangdMigrationKeyedDirectories,
  pruneMadangdMigrationStagingDirectories,
  removeMadangdMigrationStagingDirectory,
  requireStagedMadangdMigrationManifest,
  type MadangdMigrationRequestIdentity
} from './madangd-migration-staged-file'

const RECEIVED_DIRECTORY = 'received'
const STAGED_BLOB_NAME = /^([^.]+)\.([a-f0-9]{64})\.([1-9][0-9]*)\.part$/

type MadangdMigrationBlobName = Pick<MadangdMigrationBlobDescriptor, 'blobKind' | 'key'>

type ReceivedBlobPathResolver = (
  root: string,
  manifest: MadangdMigrationRequestIdentity,
  descriptor: MadangdMigrationBlobName
) => string

const receivedDirectoryPath: ReceivedBlobPathResolver = (root, manifest, descriptor) =>
  join(receivedBlobsDirectory(root, manifest), descriptor.blobKind, descriptor.key)

const RECEIVED_BLOB_DESTINATIONS: Record<MadangdMigrationBlobKind, ReceivedBlobPathResolver> = {
  'terminal-restore-hints': receivedDirectoryPath,
  'shell-history': receivedDirectoryPath,
  'agent-session-records': receivedDirectoryPath
}

export function getMadangdMigrationReceivedBlobPath(
  root: string,
  manifest: MadangdMigrationRequestIdentity,
  descriptor: MadangdMigrationBlobName
): string {
  return RECEIVED_BLOB_DESTINATIONS[descriptor.blobKind](root, manifest, descriptor)
}

export function listMadangdMigrationReceivedBlobNames(
  root: string,
  manifest: MadangdMigrationRequestIdentity,
  blobKind: MadangdMigrationBlobKind
): string[] {
  return readDirectory(join(receivedBlobsDirectory(root, manifest), blobKind))
}

export type MadangdMigrationBlobChunkStaging = {
  stagedManifest: MadangdMigrationManifest | null
  root: string
  request: MadangdMigrationBlobChunkRequest
}

export function stageMadangdMigrationBlobChunk(
  args: MadangdMigrationBlobChunkStaging
): MadangdMigrationBlobChunkResult {
  const manifest = requireStagedMadangdMigrationManifest(
    args.stagedManifest,
    args.request,
    'madangd_migration_blob_catalog_not_staged'
  )
  const descriptor = parseMadangdMigrationBlobDescriptor(args.request.blob)
  const bytes = decodeMadangdMigrationBlobChunk(args.request.bytesBase64)
  const staged = stagedBlobDescriptors(args.root, manifest)
  const existing = staged.find(
    (entry) => madangdMigrationBlobIdentity(entry) === madangdMigrationBlobIdentity(descriptor)
  )
  if (existing && !sameMadangdMigrationBlob(existing, descriptor)) {
    // Replacing staged bytes requires abort and restage.
    throw new Error(`madangd_migration_blob_descriptor_conflict:${descriptor.blobKind}`)
  }
  if (!existing) {
    assertMadangdMigrationBlobSet([...staged, descriptor])
  }
  const path = stagedBlobPath(args.root, manifest, descriptor)
  ensureMadangdMigrationDirectory(dirname(path))
  const receivedBytes = appendMadangdMigrationStagedChunk({
    channel: 'blob',
    path,
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    blobKind: descriptor.blobKind,
    key: descriptor.key,
    receivedBytes
  }
}

export function inspectMadangdMigrationBlobUploads(
  manifest: MadangdMigrationManifest,
  root: string
): MadangdMigrationBlobUploadState[] | undefined {
  const uploads = stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectReceivedBlob(root, manifest, descriptor) === 'matching'
        ? descriptor.byteLength
        : madangdMigrationStagedFileSize(
            stagedBlobPath(root, manifest, descriptor),
            descriptor.byteLength
          )
  }))
  return uploads.length > 0 ? uploads : undefined
}

export function assertMadangdMigrationBlobsReady(
  manifest: MadangdMigrationManifest,
  root: string
): void {
  for (const upload of inspectMadangdMigrationBlobUploads(manifest, root) ?? []) {
    const label = `${upload.blobKind}:${upload.key}`
    const finalStatus = inspectReceivedBlob(root, manifest, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`madangd_migration_blob_destination_conflict:${label}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`madangd_migration_blob_incomplete:${label}`)
    }
    if (
      finalStatus !== 'matching' &&
      !madangdMigrationFileMatches(stagedBlobPath(root, manifest, upload), upload)
    ) {
      throw new Error(`madangd_migration_blob_digest_mismatch:${label}`)
    }
  }
}

/** Verified staged files; call after assertMadangdMigrationBlobsReady in the same synchronous turn. */
export function stagedMadangdMigrationBlobFiles(
  manifest: MadangdMigrationManifest,
  root: string
): { descriptor: MadangdMigrationBlobDescriptor; path: string }[] {
  return stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    descriptor,
    path: stagedBlobPath(root, manifest, descriptor)
  }))
}

/** Reject missing or extra blobs, including leftovers from another capture. */
export function assertMadangdMigrationBlobSetMatches(
  manifest: MadangdMigrationManifest,
  root: string,
  expected: readonly MadangdMigrationBlobDescriptor[]
): void {
  assertMadangdMigrationBlobSet(expected)
  const wanted = new Map(expected.map((entry) => [madangdMigrationBlobIdentity(entry), entry]))
  const staged = stagedBlobDescriptors(root, manifest)
  const stagedIds = new Set(staged.map(madangdMigrationBlobIdentity))
  for (const descriptor of staged) {
    const match = wanted.get(madangdMigrationBlobIdentity(descriptor))
    if (!match || !sameMadangdMigrationBlob(match, descriptor)) {
      throw blobSetMismatch(descriptor)
    }
  }
  for (const identity of receivedBlobIdentities(root, manifest)) {
    if (!wanted.has(identity)) {
      throw new Error('madangd_migration_blob_set_mismatch')
    }
  }
  for (const descriptor of expected) {
    // Previous commit attempts may have moved these bytes to received.
    if (
      !stagedIds.has(madangdMigrationBlobIdentity(descriptor)) &&
      inspectReceivedBlob(root, manifest, descriptor) !== 'matching'
    ) {
      throw blobSetMismatch(descriptor)
    }
  }
}

/** Call assertMadangdMigrationBlobsReady in the same synchronous turn so no chunk can change verified bytes. */
export function commitMadangdMigrationBlobs(manifest: MadangdMigrationManifest, root: string): void {
  const directories = new Set<string>()
  for (const descriptor of stagedBlobDescriptors(root, manifest)) {
    const finalPath = getMadangdMigrationReceivedBlobPath(root, manifest, descriptor)
    ensureMadangdMigrationDirectory(dirname(finalPath))
    linkMadangdMigrationStagedFile({
      stagedPath: stagedBlobPath(root, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `madangd_migration_blob_destination_conflict:${descriptor.blobKind}:${descriptor.key}`
    })
    directories.add(dirname(finalPath))
  }
  for (const directory of directories) {
    syncDirectoryDurablySync(directory)
  }
  removeMadangdMigrationStagingDirectory(root, manifest)
}

/** Also remove blobs moved by a commit that never landed. */
export function abortMadangdMigrationBlobs(manifest: MadangdMigrationManifest, root: string): void {
  removeMadangdMigrationStagingDirectory(root, manifest)
  rmSync(receivedBlobsDirectory(root, manifest), { recursive: true, force: true })
}

export function pruneMadangdMigrationBlobStaging(
  stagedManifests: readonly MadangdMigrationManifest[],
  committedMigrations: readonly MadangdMigrationRequestIdentity[],
  root: string
): void {
  pruneMadangdMigrationStagingDirectories(root, stagedManifests)
  pruneMadangdMigrationKeyedDirectories(join(root, RECEIVED_DIRECTORY), [
    ...stagedManifests,
    ...committedMigrations
  ])
}

function blobSetMismatch(descriptor: MadangdMigrationBlobDescriptor): Error {
  return new Error(`madangd_migration_blob_set_mismatch:${descriptor.blobKind}:${descriptor.key}`)
}

function receivedBlobIdentities(root: string, manifest: MadangdMigrationManifest): string[] {
  const received = receivedBlobsDirectory(root, manifest)
  return MADANGD_MIGRATION_BLOB_KINDS.flatMap((blobKind) =>
    readDirectory(join(received, blobKind)).map((key) =>
      madangdMigrationBlobIdentity({ blobKind, key })
    )
  )
}

function stagedBlobDescriptors(
  root: string,
  manifest: MadangdMigrationManifest
): MadangdMigrationBlobDescriptor[] {
  const staging = madangdMigrationStagingDirectory(root, manifest)
  const descriptors: MadangdMigrationBlobDescriptor[] = []
  for (const blobKind of MADANGD_MIGRATION_BLOB_KINDS) {
    for (const name of readDirectory(join(staging, blobKind))) {
      const match = STAGED_BLOB_NAME.exec(name)
      if (!match) {
        continue
      }
      try {
        descriptors.push(
          parseMadangdMigrationBlobDescriptor({
            blobKind,
            key: match[1],
            sha256: match[2],
            byteLength: Number(match[3])
          })
        )
      } catch {
        // Foreign names cannot belong to the staged set.
      }
    }
  }
  return descriptors
}

function readDirectory(path: string): string[] {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}

function inspectReceivedBlob(
  root: string,
  manifest: MadangdMigrationManifest,
  descriptor: MadangdMigrationBlobDescriptor
): 'absent' | 'matching' | 'conflict' {
  return inspectMadangdMigrationFinalFile(
    getMadangdMigrationReceivedBlobPath(root, manifest, descriptor),
    descriptor
  )
}

function receivedBlobsDirectory(root: string, manifest: MadangdMigrationRequestIdentity): string {
  return join(root, RECEIVED_DIRECTORY, madangdMigrationStagingKey(manifest))
}

function stagedBlobPath(
  root: string,
  manifest: MadangdMigrationManifest,
  descriptor: MadangdMigrationBlobDescriptor
): string {
  return join(
    madangdMigrationStagingDirectory(root, manifest),
    descriptor.blobKind,
    `${descriptor.key}.${descriptor.sha256}.${descriptor.byteLength}.part`
  )
}
