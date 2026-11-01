import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './madang-runtime-test-mocks.spec'
import { store } from './madang-runtime-test-fixtures.spec'
import { MADANGD_MIGRATION_MANIFEST_VERSION } from '../../shared/madangd-migration/madangd-migration-manifest-validation'
import type {
  MadangdMigrationCatalogState,
  MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'

const manifest: MadangdMigrationManifest = {
  version: MADANGD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-capabilities',
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'source', sshTargetGeneration: null, targetLabel: 'Source' },
  payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
  manifestSha256: '0'.repeat(64)
}

const staged: MadangdMigrationCatalogState = {
  state: 'staged',
  migrationId: manifest.migrationId,
  manifestSha256: manifest.manifestSha256,
  stagedAt: manifest.createdAt
}

describe('runtime migration catalog capabilities', () => {
  it('refuses a catalog read when the runtime has no store', () => {
    const runtime = new OrcaRuntimeService(null)
    expect(() => runtime.getMadangdMigrationCatalogState(manifest)).toThrow('runtime_unavailable')
  })

  it('refuses a missing catalog reader on a partial store', () => {
    const runtime = new OrcaRuntimeService(store)
    expect(() => runtime.getMadangdMigrationCatalogState(manifest)).toThrow('runtime_unavailable')
  })

  it('refuses staging before mutation when the partial store cannot flush', async () => {
    const stage = vi.fn(() => staged)
    const runtime = new OrcaRuntimeService({ ...store, stageMadangdMigrationCatalog: stage })
    await expect(runtime.stageMadangdMigrationCatalog(manifest)).rejects.toThrow(
      'runtime_unavailable'
    )
    expect(stage).not.toHaveBeenCalled()
  })

  it('admits staging with only the methods that operation needs', async () => {
    const stage = vi.fn(() => staged)
    const flush = vi.fn(async () => {})
    const runtime = new OrcaRuntimeService({
      ...store,
      stageMadangdMigrationCatalog: stage,
      flushPendingOrThrowAsync: flush
    })
    await expect(runtime.stageMadangdMigrationCatalog(manifest)).resolves.toBe(staged)
    expect(stage).toHaveBeenCalledWith(manifest)
    expect(flush).toHaveBeenCalledOnce()
  })
})
