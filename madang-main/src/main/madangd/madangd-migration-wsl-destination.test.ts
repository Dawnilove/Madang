import { describe, expect, it } from 'vitest'
import type { MadangdMigrationManifestSource } from '../../shared/madangd-migration/madangd-migration-manifest'
import {
  assertMadangdMigrationSourceServedHere,
  MADANGD_MIGRATION_SOURCE_NOT_THIS_HOST,
  servesLocalWslMigrationSource
} from './madangd-migration-wsl-destination'

const WSL_SOURCE: MadangdMigrationManifestSource = {
  kind: 'local-wsl',
  distro: 'Ubuntu',
  scopeRepoIds: ['repo-1'],
  scopeFolderWorkspaceIds: [],
  generation: 1
}
const SSH_SOURCE: MadangdMigrationManifestSource = {
  sshTargetId: 'ssh-1',
  sshTargetGeneration: 1,
  targetLabel: 'Prod'
}
const WSL_HOST = { MADANG_WSL_MADANGD_HOST: '1', WSL_DISTRO_NAME: 'ubuntu' }

describe('WSL migration destination', () => {
  it('serves the WSL source only on the madangd Madang launched inside a distro', () => {
    expect(servesLocalWslMigrationSource(WSL_HOST, 'linux')).toBe(true)
    // WSLg and SSH guests lack the desktop-launched WSL host identity.
    expect(servesLocalWslMigrationSource({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux')).toBe(false)
    expect(servesLocalWslMigrationSource(WSL_HOST, 'win32')).toBe(false)
  })

  it('accepts its own distro, case-insensitively', () => {
    expect(() => assertMadangdMigrationSourceServedHere(WSL_SOURCE, WSL_HOST, 'linux')).not.toThrow()
  })

  it.each([
    ['another distro', { ...WSL_HOST, WSL_DISTRO_NAME: 'Debian' }, 'linux'],
    ['a plain Linux host', {}, 'linux'],
    ['a desktop', WSL_HOST, 'darwin']
  ] as const)('refuses a WSL source on %s', (_label, env, platform) => {
    expect(() => assertMadangdMigrationSourceServedHere(WSL_SOURCE, env, platform)).toThrow(
      MADANGD_MIGRATION_SOURCE_NOT_THIS_HOST
    )
  })

  it('refuses a source from another registration of the same distro name', () => {
    const source = { ...WSL_SOURCE, distroGuid: '{AAAA}' }
    expect(() =>
      assertMadangdMigrationSourceServedHere(
        source,
        { ...WSL_HOST, MADANG_WSL_DISTRO_GUID: '{aaaa}' },
        'linux'
      )
    ).not.toThrow()
    for (const env of [{ ...WSL_HOST, MADANG_WSL_DISTRO_GUID: '{BBBB}' }, WSL_HOST]) {
      expect(() => assertMadangdMigrationSourceServedHere(source, env, 'linux')).toThrow(
        MADANGD_MIGRATION_SOURCE_NOT_THIS_HOST
      )
    }
  })

  it('leaves the SSH conversion alone everywhere', () => {
    expect(() => assertMadangdMigrationSourceServedHere(SSH_SOURCE, {}, 'linux')).not.toThrow()
  })
})
