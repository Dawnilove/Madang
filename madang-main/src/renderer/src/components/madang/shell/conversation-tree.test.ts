import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../../shared/repo-types'
import type { FolderWorkspace } from '../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../shared/project-group-types'
import type { WorktreeLineage } from '../../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../../shared/worktree/host-qualified-identity'
import {
  buildConversationTree,
  countConversationNodes,
  getConversationStatusTone
} from './conversation-tree'

function repo(id: string): Repo {
  return {
    id,
    path: `/${id}`,
    displayName: id,
    badgeColor: '#000',
    addedAt: 0
  }
}

function worktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: `repo-1::/${id}`,
    repoId: 'repo-1',
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    path: `/${id}`,
    head: 'abc',
    branch: `refs/heads/${id}`,
    isBare: false,
    isMainWorktree: false,
    ...overrides
  }
}

function lineage(
  child: Worktree,
  parent: Worktree,
  origin: WorktreeLineage['origin']
): WorktreeLineage {
  return {
    worktreeId: child.id,
    worktreeInstanceId: 'c',
    parentWorktreeId: parent.id,
    parentWorktreeInstanceId: 'p',
    origin,
    capture: { source: 'orchestration-context', confidence: 'explicit' },
    createdAt: 0
  }
}

describe('buildConversationTree', () => {
  it('orders pinned, then the main checkout, then newest conversations', () => {
    const main = worktree('main', { isMainWorktree: true })
    const old = worktree('old', { createdAt: 1 })
    const fresh = worktree('fresh', { createdAt: 5 })
    const pinned = worktree('pinned', { isPinned: true, createdAt: 0 })
    const archived = worktree('archived', { isArchived: true })
    const [project] = buildConversationTree(
      [repo('repo-1')],
      { 'repo-1': [old, main, fresh, archived, pinned] },
      {}
    )
    expect(project.conversations.map((n) => n.worktree.displayName)).toEqual([
      'pinned',
      'main',
      'fresh',
      'old'
    ])
  })

  it('nests orchestration workers under their coordinator conversation', () => {
    const parent = worktree('login-bug', { createdAt: 1 })
    const worker = worktree('worker-a', { createdAt: 2 })
    const manual = worktree('manual-child', { createdAt: 3 })
    const [project] = buildConversationTree(
      [repo('repo-1')],
      { 'repo-1': [parent, worker, manual] },
      {
        [worker.id]: lineage(worker, parent, 'orchestration'),
        [manual.id]: lineage(manual, parent, 'manual')
      }
    )
    expect(project.conversations).toHaveLength(1)
    const [root] = project.conversations
    expect(root.children.map((n) => [n.worktree.displayName, n.createdByOrchestration])).toEqual([
      ['manual-child', false],
      ['worker-a', true]
    ])
    expect(countConversationNodes(project.conversations)).toBe(3)
  })

  it('keeps children top-level when the parent is missing or the lineage is cyclic', () => {
    const a = worktree('a')
    const b = worktree('b')
    const orphan = worktree('orphan')
    const ghost = worktree('ghost')
    const [project] = buildConversationTree(
      [repo('repo-1'), repo('empty')],
      { 'repo-1': [a, b, orphan] },
      {
        [a.id]: lineage(a, b, 'cli'),
        [b.id]: lineage(b, a, 'cli'),
        [orphan.id]: lineage(orphan, ghost, 'orchestration')
      }
    )
    expect(countConversationNodes(project.conversations)).toBe(3)
    expect(project.conversations.map((n) => n.worktree.displayName)).toContain('orphan')
  })

  it('applies Orca visibility results and the project filter', () => {
    const shown = worktree('shown')
    const sleeping = worktree('sleeping')
    const other = { ...worktree('other'), id: 'repo-2::/other', repoId: 'repo-2' }
    const result = buildConversationTree(
      [repo('repo-1'), repo('repo-2')],
      { 'repo-1': [shown, sleeping], 'repo-2': [other] },
      {},
      {
        visibleHostIdentities: new Set([shown, other].map(getWorktreeHostIdentity)),
        filterRepoIds: ['repo-1']
      }
    )
    expect(result.map((p) => p.repo?.id)).toEqual(['repo-1'])
    expect(result[0].conversations.map((n) => n.worktree.displayName)).toEqual(['shown'])
  })

  it('returns an empty list for projects without workspaces', () => {
    const result = buildConversationTree([repo('empty')], {}, {})
    expect(result).toEqual([{ repo: repo('empty'), conversations: [] }])
  })
})

function group(id: string, createdAt = 0): ProjectGroup {
  return {
    id,
    name: `group ${id}`,
    parentPath: `/${id}`,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt,
    updatedAt: createdAt
  }
}

function folder(id: string, projectGroupId: string, sortOrder: number): FolderWorkspace {
  return {
    id,
    projectGroupId,
    name: id,
    folderPath: `/${projectGroupId}`,
    executionHostId: 'local',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder,
    lastActivityAt: 0,
    createdAt: sortOrder,
    updatedAt: sortOrder
  }
}

describe('buildConversationTree folder workspaces', () => {
  const names = (project: { conversations: { worktree: Worktree }[] }) =>
    project.conversations.map((n) => n.worktree.displayName)

  it('lists group sessions under its project, in the order they were added', () => {
    const main = worktree('main', { isMainWorktree: true })
    const result = buildConversationTree(
      [
        { ...repo('repo-1'), projectGroupId: 'g1' },
        { ...repo('repo-2'), projectGroupId: 'g1' }
      ],
      { 'repo-1': [main] },
      {},
      {},
      {
        projectGroups: [group('g1')],
        workspaces: [folder('second', 'g1', 2), folder('first', 'g1', 1)]
      }
    )
    expect(names(result[0])).toEqual(['main', 'first', 'second'])
    expect(result[0].conversations[1].worktree.id).toBe('folder:first')
    // A second project in the same group does not repeat the sessions.
    expect(names(result[1])).toEqual([])
  })

  it('gives a group without a project its own heading, first, and skips empty or archived ones', () => {
    const archived = { ...folder('old', 'g3', 1), isArchived: true }
    const result = buildConversationTree(
      [repo('repo-1')],
      {},
      {},
      {},
      {
        projectGroups: [group('g2', 2), group('g1', 1), group('g3', 3), group('empty', 0)],
        workspaces: [folder('b', 'g2', 1), folder('a', 'g1', 1), archived]
      }
    )
    expect(result.map((p) => p.group?.id ?? p.repo?.id)).toEqual(['g1', 'g2', 'repo-1'])
    expect(names(result[0])).toEqual(['a'])
  })

  it('hides group-only headings while the project filter is on', () => {
    const result = buildConversationTree(
      [repo('repo-1')],
      {},
      {},
      { filterRepoIds: ['repo-1'] },
      { projectGroups: [group('g1')], workspaces: [folder('a', 'g1', 1)] }
    )
    expect(result.map((p) => p.repo?.id)).toEqual(['repo-1'])
  })
})

describe('getConversationStatusTone', () => {
  it('maps detailed workspace states to chat states', () => {
    expect(getConversationStatusTone('working')).toBe('working')
    expect(getConversationStatusTone('monitoring')).toBe('working')
    expect(getConversationStatusTone('permission')).toBe('needs-input')
    expect(getConversationStatusTone('done')).toBe('done')
    expect(getConversationStatusTone('failed')).toBe('failed')
    expect(getConversationStatusTone('active')).toBe('idle')
    expect(getConversationStatusTone('inactive')).toBe('idle')
  })
})
