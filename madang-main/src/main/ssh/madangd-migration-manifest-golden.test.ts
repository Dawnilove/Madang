import { describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import { parseMadangdMigrationManifest } from '../../shared/madangd-migration/madangd-migration-manifest-validation'
import type { SshTarget } from '../../shared/ssh-types'
import { assertMadangdMigrationManifestDigest } from '../madangd/madangd-migration-manifest-digest'
import { emptyDormantPayload } from '../persistence/migrating-madangd-catalog/madangd-source-dormant-state'
import { createMadangdMigrationManifest } from './madangd-migration-manifest-export'

const TARGET: SshTarget = {
  id: 'ssh-golden',
  label: 'Golden',
  host: 'golden.example.com',
  port: 22,
  username: 'deploy',
  generation: 4
}
const WORKTREE_ID = 'repo-golden::/srv/repo-golden/feature'

function goldenManifest() {
  const dormant = emptyDormantPayload()
  dormant.workspaceSession = {
    ...getDefaultWorkspaceSession(),
    activeRepoId: 'repo-golden',
    activeWorktreeId: WORKTREE_ID,
    tabsByWorktree: {
      [WORKTREE_ID]: [
        {
          id: 'tab-golden',
          ptyId: null,
          worktreeId: WORKTREE_ID,
          title: 'Shell',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1,
          startupCwd: '/srv/repo-golden/feature/src'
        }
      ]
    },
    openFilesByWorktree: {
      [WORKTREE_ID]: [
        {
          filePath: '/srv/repo-golden/feature/README.md',
          relativePath: 'README.md',
          worktreeId: WORKTREE_ID,
          language: 'markdown'
        }
      ]
    }
  }
  return createMadangdMigrationManifest(
    {
      collectMadangdMigrationSourceDormantState: () => dormant,
      getRepos: () => [
        {
          id: 'repo-golden',
          path: '/srv/repo-golden',
          displayName: 'Golden',
          badgeColor: '#737373',
          addedAt: 1,
          kind: 'git',
          connectionId: TARGET.id,
          projectGroupId: 'group-golden'
        }
      ],
      getProjectGroups: () => [
        {
          id: 'group-golden',
          name: 'Golden',
          parentPath: '/srv',
          connectionId: TARGET.id,
          parentGroupId: null,
          createdFrom: 'manual',
          tabOrder: 0,
          isCollapsed: false,
          color: null,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      getFolderWorkspaces: () => [
        {
          id: 'folder-golden',
          projectGroupId: 'group-golden',
          name: 'Notes',
          folderPath: '/srv/notes',
          linkedTask: null,
          comment: '',
          isArchived: false,
          isUnread: false,
          isPinned: false,
          sortOrder: 0,
          lastActivityAt: 0,
          createdAt: 1,
          updatedAt: 1
        }
      ]
    },
    TARGET,
    {
      migrationId: 'migration-golden',
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      destinationEnvironmentId: 'env-golden'
    }
  )
}

// Preserve pre-abstraction wire digests for older destinations.
const GOLDEN_SSH_MANIFEST_SHA256 =
  'fe6defc1b987c39948d5d89e310690dda7b8c21e1dfa1cf6c253bdce7abf4d68'

describe('SSH migration manifest wire shape', () => {
  it('keeps the SSH digest byte-identical to the pre-abstraction export', () => {
    expect(goldenManifest().manifestSha256).toBe(GOLDEN_SSH_MANIFEST_SHA256)
  })

  it('sends the SSH source with exactly the fields older destinations parse', () => {
    const wire = JSON.parse(JSON.stringify(goldenManifest()))
    expect(Object.keys(wire.source).sort()).toEqual([
      'sshTargetGeneration',
      'sshTargetId',
      'targetLabel'
    ])
    expect(wire.source).not.toHaveProperty('kind')
    expect(() => assertMadangdMigrationManifestDigest(wire)).not.toThrow()
    expect(parseMadangdMigrationManifest(wire)).toEqual(goldenManifest())
  })
})
