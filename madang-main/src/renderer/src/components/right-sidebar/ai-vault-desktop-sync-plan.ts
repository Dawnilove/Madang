import type { ClaudeDesktopActiveSession } from '../../../../shared/ai-vault-types'

export type DesktopSyncGroup = { key: string; label: string }
export type DesktopSyncItem = { session: ClaudeDesktopActiveSession; groupKey: string }
export type DesktopSyncPlan = {
  groups: DesktopSyncGroup[]
  items: DesktopSyncItem[]
  existing: number
}

/** Where a session opens: its project's row, or one folder workspace for its folder (made when missing). */
export type DesktopSyncTarget = { worktreeId: string } | { folderPath: string }

const LAST = Number.MAX_SAFE_INTEGER

export const forwardSlashes = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** The desktop app's sidebar groups by project folder; a worktree session belongs to its origin folder. */
export function desktopSyncGroupLabel(originCwd: string): string {
  const path = forwardSlashes(originCwd)
  if (/\/scratch-workspaces\//.test(path)) {
    return 'Claude'
  }
  return path.split('/').pop() || path
}

/**
 * Which active desktop sessions to open as tabs, listed like the desktop sidebar: sessions the user filed
 * into a desktop group under that group's name and order (as in ai-vault-desktop-regroup.ts), the rest
 * under their origin folder. A session already open in a tab is counted, not listed.
 */
export function planDesktopSync(args: {
  active: readonly ClaudeDesktopActiveSession[]
  isOpen: (sessionId: string) => boolean
}): DesktopSyncPlan {
  const groups = new Map<string, DesktopSyncGroup>()
  const items: DesktopSyncItem[] = []
  let existing = 0
  const ordered = [...args.active].sort(
    (a, b) =>
      (a.group?.rank ?? LAST) - (b.group?.rank ?? LAST) ||
      (a.group?.sessionRank ?? 0) - (b.group?.sessionRank ?? 0)
  )
  for (const session of ordered) {
    if (args.isOpen(session.sessionId)) {
      existing += 1
      continue
    }
    const folderPath = forwardSlashes(session.cwd)
    const title = session.title || folderPath.split('/').pop() || session.sessionId
    const origin = forwardSlashes(session.originCwd)
    const key = session.group ? `desktop-group:${session.group.id}` : origin
    if (!groups.has(key)) {
      groups.set(key, { key, label: session.group?.name ?? desktopSyncGroupLabel(origin) })
    }
    items.push({ session: { ...session, title }, groupKey: key })
  }
  return { groups: [...groups.values()], items, existing }
}

/**
 * The row whose folder is exactly the session's folder: a project's worktree row, else a folder workspace,
 * else that folder to make one for. Chat only opens where the folders match, so no nearby row will do.
 */
export function desktopSyncTarget(args: {
  cwd: string
  worktrees: readonly { id: string; path: string; isArchived?: boolean }[]
  folders: readonly { id: string; folderPath: string | null; isArchived?: boolean }[]
}): DesktopSyncTarget {
  const folderPath = forwardSlashes(args.cwd)
  // Windows paths compare without case.
  const same = (path: string): boolean =>
    forwardSlashes(path).toLowerCase() === folderPath.toLowerCase()
  const worktree = args.worktrees.find((entry) => !entry.isArchived && same(entry.path))
  if (worktree) {
    return { worktreeId: worktree.id }
  }
  const existing = args.folders.find(
    (workspace) => !workspace.isArchived && same(workspace.folderPath ?? '')
  )
  return existing ? { worktreeId: `folder:${existing.id}` } : { folderPath }
}
