import { describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from '../constants'
import {
  assertMadangdMigrationScrollbackReferences,
  MAX_MADANGD_MIGRATION_SCROLLBACK_SNAPSHOTS,
  MadangdMigrationSnapshotChunkRequestSchema,
  parseMadangdMigrationSnapshotChunkResult,
  parseMadangdMigrationTerminalScrollbackSnapshots,
  type MadangdMigrationSnapshotChunkRequest,
  type MadangdMigrationTerminalScrollbackSnapshot
} from './madangd-migration-scrollback'
import { TERMINAL_SCROLLBACK_STORE_BYTE_LIMIT } from '../terminal-scrollback-limits'

const DIGEST = 'a'.repeat(64)

describe('madangd migration scrollback wire validation', () => {
  it('accepts only canonical non-empty bounded base64 chunks', () => {
    const request = chunkRequest('YQ==')
    expect(MadangdMigrationSnapshotChunkRequestSchema.safeParse(request).success).toBe(true)
    expect(
      MadangdMigrationSnapshotChunkRequestSchema.safeParse({ ...request, futureField: 1 }).success,
      'a newer client field'
    ).toBe(true)
    for (const bytesBase64 of ['', 'YQ', 'YQ=', 'A===', '***=']) {
      expect(
        MadangdMigrationSnapshotChunkRequestSchema.safeParse({ ...request, bytesBase64 }).success
      ).toBe(false)
    }
  })

  it('requires an acknowledgment for exactly the decoded chunk length', () => {
    const request = chunkRequest(Buffer.from('abc').toString('base64'), 7)
    expect(
      parseMadangdMigrationSnapshotChunkResult(
        {
          migrationId: request.migrationId,
          manifestSha256: request.manifestSha256,
          ref: request.ref,
          acknowledgedOffset: 10
        },
        request
      ).acknowledgedOffset
    ).toBe(10)
    for (const acknowledgedOffset of [7, 9, 11]) {
      expect(() =>
        parseMadangdMigrationSnapshotChunkResult(
          {
            migrationId: request.migrationId,
            manifestSha256: request.manifestSha256,
            ref: request.ref,
            acknowledgedOffset
          },
          request
        )
      ).toThrow('madangd_migration_snapshot_chunk_result_invalid')
    }
  })

  it('requires unique refs and tab/leaf identities', () => {
    const first = descriptor(1)
    expect(() =>
      parseMadangdMigrationTerminalScrollbackSnapshots([first, { ...descriptor(2), ref: first.ref }])
    ).toThrow('madangd_migration_dormant_scrollback_snapshot_ref_duplicate')
    expect(() =>
      parseMadangdMigrationTerminalScrollbackSnapshots([
        first,
        { ...descriptor(2), tabId: first.tabId, leafId: first.leafId }
      ])
    ).toThrow('madangd_migration_dormant_scrollback_snapshot_leaf_duplicate')
  })

  it('enforces descriptor count, per-file, and aggregate limits', () => {
    expect(() =>
      parseMadangdMigrationTerminalScrollbackSnapshots(
        Array.from({ length: MAX_MADANGD_MIGRATION_SCROLLBACK_SNAPSHOTS + 1 }, (_, index) =>
          descriptor(index + 1)
        )
      )
    ).toThrow('madangd_migration_dormant_scrollback_snapshots_too_many')
    expect(() =>
      parseMadangdMigrationTerminalScrollbackSnapshots([
        { ...descriptor(1), byteLength: TERMINAL_SCROLLBACK_STORE_BYTE_LIMIT + 1 }
      ])
    ).toThrow('madangd_migration_dormant_scrollback_size_invalid')
    expect(() =>
      parseMadangdMigrationTerminalScrollbackSnapshots(
        Array.from({ length: 52 }, (_, index) => ({
          ...descriptor(index + 1),
          byteLength: TERMINAL_SCROLLBACK_STORE_BYTE_LIMIT
        }))
      )
    ).toThrow('madangd_migration_dormant_scrollback_snapshots_too_large')
  })

  it('requires one exact descriptor for every published session ref', () => {
    const session = getDefaultWorkspaceSession()
    const first = descriptor(1)
    session.terminalLayoutsByTabId = {
      [first.tabId]: {
        root: { type: 'leaf', leafId: first.leafId },
        activeLeafId: first.leafId,
        expandedLeafId: null,
        scrollbackRefsByLeafId: { [first.leafId]: first.ref }
      }
    }
    expect(() => assertMadangdMigrationScrollbackReferences(session, [first])).not.toThrow()
    expect(() => assertMadangdMigrationScrollbackReferences(session, [])).toThrow(
      'madangd_migration_dormant_scrollback_reference_invalid'
    )
    expect(() =>
      assertMadangdMigrationScrollbackReferences(session, [{ ...first, ref: descriptor(2).ref }])
    ).toThrow('madangd_migration_dormant_scrollback_reference_invalid')
    expect(() => assertMadangdMigrationScrollbackReferences(session, [first, descriptor(2)])).toThrow(
      'madangd_migration_dormant_scrollback_reference_invalid'
    )
  })
})

function chunkRequest(bytesBase64: string, offset = 0): MadangdMigrationSnapshotChunkRequest {
  return {
    migrationId: 'migration-1',
    manifestSha256: DIGEST,
    ref: `v1-${'1'.repeat(32)}`,
    offset,
    bytesBase64
  }
}

function descriptor(index: number): MadangdMigrationTerminalScrollbackSnapshot {
  const identity = index.toString(16).padStart(32, '0')
  return {
    tabId: `tab-${index}`,
    leafId: `leaf-${index}`,
    ref: `v1-${identity}`,
    sha256: index.toString(16).padStart(64, '0'),
    byteLength: 1
  }
}
