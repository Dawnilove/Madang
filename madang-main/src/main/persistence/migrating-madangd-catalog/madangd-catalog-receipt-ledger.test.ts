import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { MAX_MADANGD_MIGRATION_IMPORT_RECEIPTS } from '../../../shared/madangd-migration/madangd-migration-manifest-validation'
import { manifest } from './persistence-madangd-migration-catalog-fixture'
import {
  expireMadangdMigrationStages,
  findMadangdMigrationImportReceipt,
  MADANGD_MIGRATION_STAGE_TTL_MS,
  recordMadangdMigrationImportReceipt
} from './madangd-catalog-receipt-ledger'

const empty = { repositories: [], projectGroups: [], folderWorkspaces: [] }

function receiptFor(migrationId: string) {
  const input = manifest({ migrationId, payload: empty })
  return {
    input,
    receipt: {
      version: input.version,
      migrationId,
      manifestSha256: input.manifestSha256,
      source: input.source,
      importedAt: '2026-10-01T00:00:00.000Z',
      repositoryIds: [],
      projectGroupIds: [],
      folderWorkspaceIds: []
    }
  }
}

describe('madangd migration receipt ledger', () => {
  it('keeps answering for a commit whose receipt aged out of the bounded list', () => {
    const state = getDefaultPersistedState('/tmp/madangd-receipt-ledger')
    const first = receiptFor('migration-0')
    recordMadangdMigrationImportReceipt(state, first.receipt)
    for (let index = 1; index <= MAX_MADANGD_MIGRATION_IMPORT_RECEIPTS; index++) {
      recordMadangdMigrationImportReceipt(state, receiptFor(`migration-${index}`).receipt)
    }
    expect(state.madangdMigrationImportReceipts).toHaveLength(MAX_MADANGD_MIGRATION_IMPORT_RECEIPTS)
    expect(findMadangdMigrationImportReceipt(state, first.input)).toEqual(first.receipt)
    expect(findMadangdMigrationImportReceipt(state, receiptFor('never').input)).toBeUndefined()
  })

  it('expires a stage no client came back for', () => {
    const state = getDefaultPersistedState('/tmp/madangd-receipt-ledger')
    const stagedAt = '2026-10-01T00:00:00.000Z'
    state.madangdMigrationStagedCatalogs = [{ version: 1, manifest: manifest(), stagedAt }]
    const start = Date.parse(stagedAt)
    expect(expireMadangdMigrationStages(state, start + MADANGD_MIGRATION_STAGE_TTL_MS - 1)).toBe(false)
    expect(expireMadangdMigrationStages(state, start + MADANGD_MIGRATION_STAGE_TTL_MS)).toBe(true)
    expect(state.madangdMigrationStagedCatalogs).toEqual([])
  })
})
