import { describe, expect, it, vi } from 'vitest'
import type {
  MadangdMigrationCatalogAbortResult,
  MadangdMigrationCatalogReferenceAbortResult,
  MadangdMigrationCatalogState
} from '../../shared/madangd-migration/madangd-migration-manifest'
import { madangdMigrationCutoverFixture } from '../ssh/madangd-migration-cutover-fixture'
import {
  abortStagedMadangdMigrationCatalogByReferenceDurably,
  abortStagedMadangdMigrationCatalogDurably,
  commitStagedMadangdMigrationCatalogDurably,
  stageMadangdMigrationCatalogDurably
} from './madangd-migration-catalog-import'

const { manifest } = madangdMigrationCutoverFixture()
const reference = { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }

describe('durable madangd migration catalog import', () => {
  it('does not acknowledge staging until its dormant manifest is durable', async () => {
    const diskError = new Error('disk full')
    const staged: MadangdMigrationCatalogState = {
      state: 'staged',
      ...reference,
      stagedAt: '2026-10-01T00:00:01.000Z'
    }
    const stage = vi.fn().mockReturnValue(staged)
    const flush = vi.fn().mockRejectedValueOnce(diskError).mockResolvedValueOnce(undefined)
    const args = {
      store: {
        stageMadangdMigrationCatalog: stage,
        flushPendingOrThrowAsync: flush
      },
      manifest
    }

    await expect(stageMadangdMigrationCatalogDurably(args)).rejects.toBe(diskError)
    await expect(stageMadangdMigrationCatalogDurably(args)).resolves.toBe(staged)
    expect(stage).toHaveBeenCalledTimes(2)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('publishes a committed catalog only after its receipt is durable', async () => {
    const diskError = new Error('disk full')
    const committed: MadangdMigrationCatalogState = {
      state: 'committed',
      ...reference,
      receipt: {
        version: manifest.version,
        ...reference,
        source: manifest.source,
        importedAt: '2026-10-01T00:00:02.000Z',
        repositoryIds: [],
        projectGroupIds: [],
        folderWorkspaceIds: []
      }
    }
    const commit = vi.fn().mockReturnValue(committed)
    const flush = vi.fn().mockRejectedValueOnce(diskError).mockResolvedValueOnce(undefined)
    const onDurableCommit = vi.fn()
    const args = {
      store: {
        commitStagedMadangdMigrationCatalog: commit,
        flushPendingOrThrowAsync: flush
      },
      manifest,
      onDurableCommit
    }

    await expect(commitStagedMadangdMigrationCatalogDurably(args)).rejects.toBe(diskError)
    expect(onDurableCommit).not.toHaveBeenCalled()
    await expect(commitStagedMadangdMigrationCatalogDurably(args)).resolves.toBe(committed)
    expect(onDurableCommit).toHaveBeenCalledOnce()
  })

  it('reflushes an already-absent abort after the first flush failed', async () => {
    const aborted: MadangdMigrationCatalogAbortResult = {
      state: 'absent',
      ...reference,
      aborted: true
    }
    const unchanged: MadangdMigrationCatalogAbortResult = { ...aborted, aborted: false }
    const abort = vi.fn().mockReturnValueOnce(aborted).mockReturnValueOnce(unchanged)
    const flush = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const args = {
      store: {
        abortStagedMadangdMigrationCatalog: abort,
        flushPendingOrThrowAsync: flush
      },
      manifest
    }

    await expect(abortStagedMadangdMigrationCatalogDurably(args)).rejects.toThrow('disk full')
    await expect(abortStagedMadangdMigrationCatalogDurably(args)).resolves.toEqual({
      ...unchanged,
      durableAbsent: true
    })
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('answers an abort by reference absent only once its flush succeeds', async () => {
    const aborted: MadangdMigrationCatalogReferenceAbortResult = {
      ...reference,
      state: 'absent',
      aborted: true
    }
    const unchanged: MadangdMigrationCatalogReferenceAbortResult = { ...aborted, aborted: false }
    const abort = vi.fn().mockReturnValueOnce(aborted).mockReturnValueOnce(unchanged)
    const flush = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const args = {
      store: {
        abortStagedMadangdMigrationCatalogByReference: abort,
        flushPendingOrThrowAsync: flush
      },
      reference
    }

    await expect(abortStagedMadangdMigrationCatalogByReferenceDurably(args)).rejects.toThrow(
      'disk full'
    )
    await expect(abortStagedMadangdMigrationCatalogByReferenceDurably(args)).resolves.toEqual({
      ...unchanged,
      durableAbsent: true
    })
    expect(flush).toHaveBeenCalledTimes(2)
  })
})
