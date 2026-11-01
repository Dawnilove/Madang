import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MadangdMigrationManifest } from '../../shared/madangd-migration/madangd-migration-manifest'
import type { MadangdMigrationSourceCutover } from '../../shared/madangd-migration/madangd-migration-source-cutover'

const journal = vi.hoisted(() => {
  const state: {
    cutovers: Pick<MadangdMigrationSourceCutover, 'phase' | 'manifest'>[]
    listener: ((userDataPath: string) => void) | null
  } = { cutovers: [], listener: null }
  return state
})
vi.mock('./madangd-migration-cutover-journal', () => ({
  listMadangdMigrationSourceCutovers: () => journal.cutovers,
  setMadangdMigrationJournalChangeListener: (listener: (path: string) => void) => {
    journal.listener = listener
  }
}))

const { installMadangdMigrationScrollbackRetention } =
  await import('./madangd-migration-scrollback-retention-wiring')

function manifest(migrationId: string): MadangdMigrationManifest {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the wiring only forwards manifests; the store fake reads the id.
  return { migrationId } as MadangdMigrationManifest
}

afterEach(() => {
  journal.cutovers = []
  journal.listener = null
})

describe('scrollback retention follows the migration journal', () => {
  it('holds from the fence until commit, across journal changes and a restart', () => {
    const sync = vi.fn<(pending: readonly MadangdMigrationManifest[]) => void>()
    const held = (): string[] =>
      (sync.mock.calls.at(-1)?.[0] ?? []).map((entry) => entry.migrationId)
    journal.cutovers = [{ phase: 'source-fenced', manifest: manifest('m1') }]

    // Startup rebuilds what an unfinished journal holds.
    installMadangdMigrationScrollbackRetention('/profile', {
      syncMadangdMigrationScrollbackRetention: sync
    })
    expect(held()).toEqual(['m1'])

    journal.cutovers = [{ phase: 'destination-staged', manifest: manifest('m1') }]
    journal.listener?.('/profile')
    expect(held()).toEqual(['m1'])

    journal.cutovers = [{ phase: 'destination-committed', manifest: manifest('m1') }]
    journal.listener?.('/profile')
    expect(held()).toEqual([])
  })

  it('keeps what it holds when the journal cannot be read', () => {
    const sync = vi.fn()
    installMadangdMigrationScrollbackRetention('/profile', {
      syncMadangdMigrationScrollbackRetention: sync
    })
    journal.cutovers = new Proxy([], {
      get: () => {
        throw new Error('unreadable')
      }
    })
    journal.listener?.('/profile')
    expect(sync).toHaveBeenCalledTimes(1)
  })
})
