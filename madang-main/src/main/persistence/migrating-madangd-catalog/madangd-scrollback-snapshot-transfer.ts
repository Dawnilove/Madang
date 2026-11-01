import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MadangdMigrationManifest } from '../../../shared/madangd-migration/madangd-migration-manifest'
import {
  decodeMadangdMigrationSnapshotChunk,
  type MadangdMigrationSnapshotChunkRequest,
  type MadangdMigrationSnapshotChunkResult,
  type MadangdMigrationSnapshotUploadState,
  type MadangdMigrationTerminalScrollbackSnapshot
} from '../../../shared/madangd-migration/madangd-migration-scrollback'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  getTerminalScrollbackSnapshotPath,
  getTerminalScrollbackSnapshotRoot,
  type TerminalScrollbackSnapshotStorage
} from '../../terminal-scrollback-snapshots'
import {
  appendMadangdMigrationStagedChunk,
  ensureMadangdMigrationDirectory,
  inspectMadangdMigrationFinalFile,
  linkMadangdMigrationStagedFile,
  madangdMigrationFileMatches,
  madangdMigrationStagedFileSize,
  madangdMigrationStagingDirectory,
  pruneMadangdMigrationStagingDirectories,
  removeMadangdMigrationStagingDirectory,
  requireStagedMadangdMigrationManifest
} from './madangd-migration-staged-file'

/** Only the staged manifest's snapshots may receive chunks; retried ranges must match. */
export function stageMadangdMigrationSnapshotChunk(args: {
  stagedManifest: MadangdMigrationManifest | null
  storage: TerminalScrollbackSnapshotStorage
  request: MadangdMigrationSnapshotChunkRequest
}): MadangdMigrationSnapshotChunkResult {
  const manifest = requireStagedMadangdMigrationManifest(
    args.stagedManifest,
    args.request,
    'madangd_migration_snapshot_catalog_not_staged'
  )
  const descriptor = requireDescriptor(manifest, args.request.ref)
  const bytes = decodeMadangdMigrationSnapshotChunk(args.request.bytesBase64)
  ensureMadangdMigrationDirectory(stagingDirectory(args.storage, manifest))
  const acknowledgedOffset = appendMadangdMigrationStagedChunk({
    channel: 'snapshot',
    path: stagedSnapshotPath(args.storage, manifest, descriptor),
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    ref: args.request.ref,
    acknowledgedOffset
  }
}

export function inspectMadangdMigrationSnapshotUploads(
  manifest: MadangdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): MadangdMigrationSnapshotUploadState[] | undefined {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  if (snapshots.length === 0) {
    return undefined
  }
  return snapshots.map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectFinalSnapshot(storage, descriptor) === 'matching'
        ? descriptor.byteLength
        : madangdMigrationStagedFileSize(
            stagedSnapshotPath(storage, manifest, descriptor),
            descriptor.byteLength
          )
  }))
}

export function assertMadangdMigrationSnapshotsReady(
  manifest: MadangdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  for (const upload of inspectMadangdMigrationSnapshotUploads(manifest, storage) ?? []) {
    const finalStatus = inspectFinalSnapshot(storage, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`madangd_migration_snapshot_destination_conflict:${upload.ref}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`madangd_migration_snapshot_incomplete:${upload.ref}`)
    }
    const path =
      finalStatus === 'matching'
        ? getTerminalScrollbackSnapshotPath(upload.ref, storage)
        : stagedSnapshotPath(storage, manifest, upload)
    if (!path || !madangdMigrationFileMatches(path, upload)) {
      throw new Error(`madangd_migration_snapshot_digest_mismatch:${upload.ref}`)
    }
  }
}

export function commitMadangdMigrationSnapshots(
  manifest: MadangdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  assertMadangdMigrationSnapshotsReady(manifest, storage)
  const root = getTerminalScrollbackSnapshotRoot(storage)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const descriptor of snapshots) {
    const finalPath = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
    if (!finalPath) {
      throw new Error('madangd_migration_snapshot_ref_invalid')
    }
    linkMadangdMigrationStagedFile({
      stagedPath: stagedSnapshotPath(storage, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `madangd_migration_snapshot_destination_conflict:${descriptor.ref}`
    })
  }
  syncDirectoryDurablySync(root)
  removeMadangdMigrationStagingDirectory(root, manifest)
}

export function abortMadangdMigrationSnapshots(
  manifest: MadangdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  removeMadangdMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

export function pruneMadangdMigrationSnapshotStaging(
  stagedManifests: readonly MadangdMigrationManifest[],
  storage: TerminalScrollbackSnapshotStorage
): void {
  pruneMadangdMigrationStagingDirectories(getTerminalScrollbackSnapshotRoot(storage), stagedManifests)
}

function requireDescriptor(
  manifest: MadangdMigrationManifest,
  ref: string
): MadangdMigrationTerminalScrollbackSnapshot {
  const descriptor = manifest.payload.dormantState?.terminalScrollbackSnapshots?.find(
    (entry) => entry.ref === ref
  )
  if (!descriptor) {
    throw new Error('madangd_migration_snapshot_unknown')
  }
  return descriptor
}

function inspectFinalSnapshot(
  storage: TerminalScrollbackSnapshotStorage,
  descriptor: MadangdMigrationTerminalScrollbackSnapshot
): 'absent' | 'matching' | 'conflict' {
  return inspectMadangdMigrationFinalFile(
    getTerminalScrollbackSnapshotPath(descriptor.ref, storage),
    descriptor
  )
}

function stagingDirectory(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: MadangdMigrationManifest
): string {
  return madangdMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

function stagedSnapshotPath(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: MadangdMigrationManifest,
  descriptor: MadangdMigrationTerminalScrollbackSnapshot
): string {
  return join(stagingDirectory(storage, manifest), `${descriptor.ref}.${descriptor.sha256}.part`)
}
