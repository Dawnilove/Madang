import { describe, expect, it } from 'vitest'
import {
  MAX_MADANGD_MIGRATION_BLOB_TOTAL_BYTES,
  MADANGD_MIGRATION_BLOB_KIND_CONTRACTS,
  MadangdMigrationBlobChunkRequestSchema,
  MadangdMigrationBlobDescriptorSchema,
  assertMadangdMigrationBlobSet,
  findUnsupportedMigrationBlobKind,
  madangdMigrationBlobKindUnsupportedBlocker,
  parseMadangdMigrationBlobChunkResult,
  parseMadangdMigrationBlobDescriptor,
  parseMadangdMigrationBlobUploadStates,
  requiredMigrationBlobCapabilities,
  type MadangdMigrationBlobDescriptor
} from './madangd-migration-blob-transfer'
import { parseMadangdMigrationCatalogState } from './madangd-migration-catalog-state'
import { MADANGD_MIGRATION_MANIFEST_VERSION } from './madangd-migration-manifest-validation'
import type { MadangdMigrationManifest } from './madangd-migration-manifest'
import { MADANGD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY } from '../madangd-runtime-capabilities'

const HASH = 'a'.repeat(16)
const DIGEST = 'b'.repeat(64)

function blob(overrides: Partial<MadangdMigrationBlobDescriptor> = {}): MadangdMigrationBlobDescriptor {
  return {
    blobKind: 'shell-history',
    key: `${HASH}-zsh`,
    sha256: DIGEST,
    byteLength: 10,
    ...overrides
  }
}

const manifest: MadangdMigrationManifest = {
  version: MADANGD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-1',
  manifestSha256: 'c'.repeat(64),
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'ssh-prod', sshTargetGeneration: 7, targetLabel: 'Production' },
  payload: { repositories: [], projectGroups: [], folderWorkspaces: [] }
}

describe('madangd migration blob contract', () => {
  it.each([
    ['terminal-restore-hints', 'migration', true],
    ['terminal-restore-hints', HASH, false],
    ['shell-history', `${HASH}-bash`, true],
    ['shell-history', `${HASH}-fish`, true],
    ['shell-history', `${HASH}-pwsh`, false],
    ['shell-history', `${'A'.repeat(16)}-zsh`, false],
    ['shell-history', `${HASH}.zsh`, false],
    ['agent-session-records', '0f8e2c1a-7b3d-4e5f-9a0b-1c2d3e4f5a6b', true],
    ['agent-session-records', 'Session-Mixed-Case', false],
    ['agent-session-records', '../escape', false],
    ['agent-session-records', 'a.b', false],
    ['agent-session-records', 'x'.repeat(129), false],
    // Windows device names: one with any extension is the device too.
    ['agent-session-records', 'con', false],
    ['agent-session-records', 'prn', false],
    ['agent-session-records', 'aux', false],
    ['agent-session-records', 'nul', false],
    ['agent-session-records', 'com0', false],
    ['agent-session-records', 'com9', false],
    ['agent-session-records', 'lpt1', false],
    ['agent-session-records', 'console', true],
    ['agent-session-records', 'com10', true],
    ['agent-session-records', 'nul-1', true]
  ] as const)('%s key %s valid=%s', (blobKind, key, valid) => {
    const parse = () => parseMadangdMigrationBlobDescriptor(blob({ blobKind, key }))
    if (valid) {
      expect(parse().key).toBe(key)
    } else {
      expect(parse).toThrow('madangd_migration_blob_key_invalid')
    }
  })

  it('enforces per-kind byte caps, a non-empty body, and the set caps', () => {
    const cap = MADANGD_MIGRATION_BLOB_KIND_CONTRACTS['terminal-restore-hints'].maxBytes
    const hints = blob({ blobKind: 'terminal-restore-hints', key: 'migration' })
    expect(parseMadangdMigrationBlobDescriptor({ ...hints, byteLength: cap }).byteLength).toBe(cap)
    expect(() => parseMadangdMigrationBlobDescriptor({ ...hints, byteLength: cap + 1 })).toThrow(
      'madangd_migration_blob_too_large'
    )
    expect(() => parseMadangdMigrationBlobDescriptor(blob({ byteLength: 0 }))).toThrow()
    expect(() => assertMadangdMigrationBlobSet([blob(), blob({ sha256: 'd'.repeat(64) })])).toThrow(
      'madangd_migration_blob_duplicate'
    )
    const big = MADANGD_MIGRATION_BLOB_KIND_CONTRACTS['shell-history'].maxBytes
    const many = Array.from({ length: MAX_MADANGD_MIGRATION_BLOB_TOTAL_BYTES / big + 1 }, (_, i) =>
      blob({ key: `${i.toString(16).padStart(16, '0')}-zsh`, byteLength: big })
    )
    expect(() => assertMadangdMigrationBlobSet(many)).toThrow('madangd_migration_blobs_too_large')
  })

  it('requires the channel plus each sent kind, and names the first missing kind', () => {
    const hints = blob({ blobKind: 'terminal-restore-hints', key: 'migration' })
    expect(requiredMigrationBlobCapabilities([])).toEqual([])
    expect(requiredMigrationBlobCapabilities([blob(), hints, blob()])).toEqual([
      MADANGD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
      'madangd.migration-blob.terminal-restore-hints.v1',
      'madangd.migration-blob.shell-history.v1'
    ])
    const all = requiredMigrationBlobCapabilities([blob(), hints])
    expect(findUnsupportedMigrationBlobKind([blob(), hints], all)).toBeNull()
    expect(
      findUnsupportedMigrationBlobKind(
        [blob(), hints],
        all.filter((entry) => entry !== MADANGD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY)
      )
    ).toBe('shell-history')
    expect(
      findUnsupportedMigrationBlobKind(
        [blob(), hints],
        [MADANGD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY, 'madangd.migration-blob.shell-history.v1']
      )
    ).toBe('terminal-restore-hints')
    expect(madangdMigrationBlobKindUnsupportedBlocker('shell-history')).toMatch(
      /^madangd_migration_destination_blob_kind_unsupported:shell-history:/
    )
  })

  // Drafts stay on each desktop; a chunk from a build that once shed them is refused, not stored.
  it('refuses the retired editor-drafts kind', () => {
    expect(
      MadangdMigrationBlobDescriptorSchema.safeParse({
        blobKind: 'editor-drafts',
        key: 'drafts',
        sha256: 'b'.repeat(64),
        byteLength: 4
      }).success
    ).toBe(false)
  })

  it('keeps unknown request fields out and checks the acknowledged length', () => {
    const request = MadangdMigrationBlobChunkRequestSchema.parse({
      migrationId: manifest.migrationId,
      manifestSha256: manifest.manifestSha256,
      blob: blob(),
      offset: 4,
      bytesBase64: 'YWJj',
      futureField: true
    })
    expect(request).not.toHaveProperty('futureField')
    const result = {
      migrationId: manifest.migrationId,
      manifestSha256: manifest.manifestSha256,
      blobKind: 'shell-history',
      key: `${HASH}-zsh`,
      receivedBytes: 7
    }
    expect(parseMadangdMigrationBlobChunkResult(result, request).receivedBytes).toBe(7)
    expect(() =>
      parseMadangdMigrationBlobChunkResult({ ...result, receivedBytes: 6 }, request)
    ).toThrow('madangd_migration_blob_chunk_result_invalid')
  })

  it('parses upload states strictly and treats an absent list as nothing staged', () => {
    expect(parseMadangdMigrationBlobUploadStates(undefined)).toBeUndefined()
    expect(parseMadangdMigrationBlobUploadStates([{ ...blob(), receivedBytes: 3 }])).toEqual([
      { ...blob(), receivedBytes: 3 }
    ])
    expect(() => parseMadangdMigrationBlobUploadStates([{ ...blob(), receivedBytes: 11 }])).toThrow(
      'madangd_migration_blob_state_invalid'
    )
    expect(() => parseMadangdMigrationBlobUploadStates({})).toThrow(
      'madangd_migration_blob_state_invalid'
    )
  })
})

describe('madangd migration catalog state with blob uploads', () => {
  const staged = {
    state: 'staged',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    stagedAt: '2026-08-30T12:01:00.000Z'
  }

  it('still accepts a staged state from a host that predates blobs', () => {
    expect(parseMadangdMigrationCatalogState(staged, manifest)).toEqual(staged)
  })

  it('carries blob uploads from a host that has them', () => {
    const uploads = [{ ...blob(), receivedBytes: 10 }]
    expect(parseMadangdMigrationCatalogState({ ...staged, blobUploads: uploads }, manifest)).toEqual({
      ...staged,
      blobUploads: uploads
    })
    expect(() =>
      parseMadangdMigrationCatalogState(
        { ...staged, blobUploads: [{ ...blob({ key: 'bad' }), receivedBytes: 0 }] },
        manifest
      )
    ).toThrow('madangd_migration_blob_key_invalid')
  })
})
