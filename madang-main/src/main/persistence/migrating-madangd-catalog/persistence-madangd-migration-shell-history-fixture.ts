import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MadangdMigrationBlobDescriptor } from '../../../shared/madangd-migration/madangd-migration-blob-transfer'
import type { MadangdMigrationManifest } from '../../../shared/madangd-migration/madangd-migration-manifest'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { getMadangdMigrationReceivedBlobPath } from './madangd-migration-blob-staging'
import { buildWslMoveShellHistoryBlobs } from '../moving-wsl-projects/wsl-move-shell-history-blobs'
import { commitStagedMadangdMigrationCatalogDurably } from '../../runtime/madangd-migration-catalog-import'
import { getHistoryRoot } from '../../terminal-history-paths'
import { hashWorktreeId } from '../../terminal-history-id'
import { FOLDER_WORKSPACE } from './persistence-madangd-migration-catalog-fixture'
import { testState, type createStore } from '../persistence-test-harness'

type Store = ReturnType<typeof createStore>
export type EncodedBlob = { descriptor: MadangdMigrationBlobDescriptor; bytes: Buffer }

export const FOLDER_KEY = folderWorkspaceKey(FOLDER_WORKSPACE.id)
export const ZSH = ': 1700000000:0;make test\n'
export const BASH = 'git status\n'

// Migration payloads use source IDs already mapped to this host.
export async function encodedHistories(
  desktopHistory: string,
  files: { worktreeId: string; file: string; content: string }[]
): Promise<EncodedBlob[]> {
  for (const { worktreeId, file, content } of files) {
    const directory = join(desktopHistory, hashWorktreeId(worktreeId))
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, file), content)
  }
  const ids = [...new Set(files.map((entry) => entry.worktreeId))]
  const blobs = await buildWslMoveShellHistoryBlobs({
    distro: 'Ubuntu',
    historyRoot: desktopHistory,
    worktrees: ids.map((id) => ({ sourceWorktreeId: id, destinationWorktreeId: id }))
  })
  return Promise.all(
    blobs.descriptors.map(async (descriptor) => ({
      descriptor,
      bytes: await blobs.source.readChunk(descriptor, 0, descriptor.byteLength)
    }))
  )
}

export function rawBlob(key: string, bytes: Buffer): EncodedBlob {
  return {
    bytes,
    descriptor: {
      blobKind: 'shell-history',
      key,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length
    }
  }
}

export function stage(store: Store, input: MadangdMigrationManifest, blobs: EncodedBlob[]): void {
  store.stageMadangdMigrationCatalog(input)
  for (const blob of blobs) {
    store.stageMadangdMigrationBlobChunk({
      migrationId: input.migrationId,
      manifestSha256: input.manifestSha256,
      blob: blob.descriptor,
      offset: 0,
      bytesBase64: blob.bytes.toString('base64')
    })
  }
}

export function receivedPath(input: MadangdMigrationManifest, key: string): string {
  return getMadangdMigrationReceivedBlobPath(join(testState.dir, 'madangd-migration-blobs'), input, {
    blobKind: 'shell-history',
    key
  })
}

export function hostHistoryDirectory(worktreeId: string): string {
  return join(getHistoryRoot(), hashWorktreeId(worktreeId))
}

export function hostHistory(worktreeId: string, file: string): string | null {
  const path = join(hostHistoryDirectory(worktreeId), file)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

export const noLiveShells = (): boolean => false

export async function commitDurably(store: Store, input: MadangdMigrationManifest): Promise<string> {
  const result = await commitStagedMadangdMigrationCatalogDurably({
    store,
    manifest: input,
    worktreeHasLiveShells: noLiveShells,
    onDurableCommit: () => {}
  })
  return result.state
}
