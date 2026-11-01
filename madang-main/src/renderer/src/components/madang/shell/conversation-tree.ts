import type { Repo } from '../../../../../shared/repo-types'
import type { FolderWorkspace } from '../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../shared/project-group-types'
import { folderWorkspaceToWorktree } from '../../../../../shared/folder-workspace-worktree'
import type { WorktreeLineage } from '../../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../../shared/worktree/host-qualified-identity'
import type { WorktreeStatus } from '@/lib/worktree-status'

/**
 * Madang shows each workspace as one "conversation". This module only reshapes store data
 * (repos, worktrees, lineage) so the list stays a view over Orca's worktree logic, not a copy of it.
 */
export type ConversationNode = {
  worktree: Worktree
  /** Child workspaces (lineage), e.g. workers an orchestration run created for this conversation. */
  children: ConversationNode[]
  /** True when this node's lineage says an orchestration run created it. */
  createdByOrchestration: boolean
}

export type ProjectConversations = {
  /** Absent for a project group that holds only folder workspaces (e.g. synced Claude desktop sessions). */
  repo?: Repo
  /** Set for a group-only section. */
  group?: ProjectGroup
  conversations: ConversationNode[]
}

export type ConversationFolders = {
  projectGroups: readonly ProjectGroup[]
  workspaces: readonly FolderWorkspace[]
}

const NO_FOLDERS: ConversationFolders = { projectGroups: [], workspaces: [] }

// Why: folder workspaces keep the order they were added in, so synced desktop sessions keep the desktop's order.
function compareFolderWorkspaces(a: FolderWorkspace, b: FolderWorkspace): number {
  if (a.isPinned !== b.isPinned) {
    return a.isPinned ? -1 : 1
  }
  return a.sortOrder - b.sortOrder
}

function folderNodesByGroup(
  folderWorkspaces: readonly FolderWorkspace[]
): Map<string, ConversationNode[]> {
  const byGroup = new Map<string, ConversationNode[]>()
  // shortcut: Orca's host-scope filter is not applied to folder rows; add it if remote folder workspaces show here.
  const shown = folderWorkspaces.filter((f) => !f.isArchived).sort(compareFolderWorkspaces)
  for (const folder of shown) {
    const node = {
      worktree: folderWorkspaceToWorktree(folder),
      children: [],
      createdByOrchestration: false
    }
    byGroup.set(folder.projectGroupId, [...(byGroup.get(folder.projectGroupId) ?? []), node])
  }
  return byGroup
}

export type ConversationStatusTone = 'working' | 'needs-input' | 'done' | 'failed' | 'idle'

// Why: the list is a chat inbox; pinned first, then the project's own checkout, then newest first.
function compareConversations(a: Worktree, b: Worktree): number {
  if (a.isPinned !== b.isPinned) {
    return a.isPinned ? -1 : 1
  }
  if (a.isMainWorktree !== b.isMainWorktree) {
    return a.isMainWorktree ? -1 : 1
  }
  const createdDelta = (b.createdAt ?? 0) - (a.createdAt ?? 0)
  if (createdDelta !== 0) {
    return createdDelta
  }
  return a.displayName.localeCompare(b.displayName)
}

export type ConversationVisibility = {
  /** Host identities that pass Orca's sidebar filters. Absent: every non-archived workspace shows. */
  visibleHostIdentities?: ReadonlySet<string>
  /** Orca's project filter. Empty or absent: every project shows. */
  filterRepoIds?: readonly string[]
}

export function buildConversationTree(
  repos: readonly Repo[],
  worktreesByRepo: Readonly<Record<string, readonly Worktree[]>>,
  worktreeLineageById: Readonly<Record<string, WorktreeLineage>>,
  visibility: ConversationVisibility = {},
  folders: ConversationFolders = NO_FOLDERS
): ProjectConversations[] {
  const { visibleHostIdentities, filterRepoIds } = visibility
  const projectFilterOn = !!filterRepoIds && filterRepoIds.length > 0
  const shownRepos = projectFilterOn
    ? repos.filter((repo) => filterRepoIds.includes(repo.id))
    : repos
  const folderNodes = folderNodesByGroup(folders.workspaces)
  // A group's sessions show under the project that lives in it; a group with no project gets its own heading.
  const groupIdsWithRepo = new Set(repos.flatMap((repo) => repo.projectGroupId ?? []))
  const groupSections: ProjectConversations[] = projectFilterOn
    ? []
    : folders.projectGroups
        .filter((group) => !groupIdsWithRepo.has(group.id) && folderNodes.has(group.id))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((group) => ({ group, conversations: folderNodes.get(group.id)! }))
  const claimedGroupIds = new Set<string>()
  const repoSections = shownRepos.map((repo): ProjectConversations => {
    const worktrees = (worktreesByRepo[repo.id] ?? []).filter(
      (w) =>
        !w.isArchived &&
        (!visibleHostIdentities || visibleHostIdentities.has(getWorktreeHostIdentity(w)))
    )
    const byId = new Map(worktrees.map((w) => [w.id, w]))
    const childIdsByParent = new Map<string, string[]>()
    const childIds = new Set<string>()
    for (const worktree of worktrees) {
      const parentId = worktreeLineageById[worktree.id]?.parentWorktreeId
      // Why: a parent outside this project (or archived) cannot host the child, so keep it top-level.
      if (!parentId || parentId === worktree.id || !byId.has(parentId)) {
        continue
      }
      childIdsByParent.set(parentId, [...(childIdsByParent.get(parentId) ?? []), worktree.id])
      childIds.add(worktree.id)
    }

    const visited = new Set<string>()
    const toNode = (worktree: Worktree): ConversationNode => {
      visited.add(worktree.id)
      const children = (childIdsByParent.get(worktree.id) ?? [])
        .filter((id) => !visited.has(id))
        .map((id) => byId.get(id)!)
        .sort(compareConversations)
        .map(toNode)
      return {
        worktree,
        children,
        createdByOrchestration: worktreeLineageById[worktree.id]?.origin === 'orchestration'
      }
    }

    const roots = worktrees.filter((w) => !childIds.has(w.id)).sort(compareConversations)
    const conversations = roots.map(toNode)
    // Why: a lineage cycle has no root; show those rows top-level instead of dropping them.
    const orphans = worktrees.filter((w) => !visited.has(w.id)).sort(compareConversations)
    for (const orphan of orphans) {
      if (!visited.has(orphan.id)) {
        conversations.push(toNode(orphan))
      }
    }
    const groupId = repo.projectGroupId
    if (!groupId || claimedGroupIds.has(groupId)) {
      return { repo, conversations }
    }
    // Why: several projects can share a group; its sessions list once, under the first one.
    claimedGroupIds.add(groupId)
    return { repo, conversations: [...conversations, ...(folderNodes.get(groupId) ?? [])] }
  })
  // Why: group-only sections are synced desktop groups; list them first like the desktop sidebar does.
  return [...groupSections, ...repoSections]
}

/** Collapse Orca's detailed workspace status into the few states a chat user cares about. */
export function getConversationStatusTone(status: WorktreeStatus): ConversationStatusTone {
  switch (status) {
    case 'working':
    case 'monitoring':
      return 'working'
    case 'permission':
      return 'needs-input'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'active':
    case 'inactive':
    case 'interrupted':
    case 'unconfirmed':
      return 'idle'
  }
}

export function countConversationNodes(nodes: readonly ConversationNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countConversationNodes(node.children), 0)
}
