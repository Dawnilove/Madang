import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import { useAppStore } from '@/store'

export const TERMINAL_DRAWER_OPEN_RATIO = 0.65
export const TERMINAL_DRAWER_COLLAPSED_RATIO = 0.96

// Not persisted: after a restart the drawer group is just a normal bottom group.
const drawerGroupByWorktree = new Map<string, string>()
const openRatioByWorktree = new Map<string, number>()

/** Path of the vertical split whose bottom child is exactly this group, plus its current ratio. */
export function findDrawerSplit(
  node: TabGroupLayoutNode,
  groupId: string,
  path: string[] = []
): { path: string[]; ratio: number } | null {
  if (node.type === 'leaf') {
    return null
  }
  if (
    node.direction === 'vertical' &&
    node.second.type === 'leaf' &&
    node.second.groupId === groupId
  ) {
    return { path, ratio: node.ratio ?? 0.5 }
  }
  return (
    findDrawerSplit(node.first, groupId, [...path, 'first']) ??
    findDrawerSplit(node.second, groupId, [...path, 'second'])
  )
}

/** Open the drawer (a terminal in a bottom split group), or fold/unfold it when it already exists. */
export function toggleTerminalDrawer(
  store: Pick<typeof useAppStore, 'getState'> = useAppStore
): void {
  const state = store.getState()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return
  }
  const layout = state.layoutByWorktree[worktreeId]
  const drawerGroupId = drawerGroupByWorktree.get(worktreeId)
  const found = layout && drawerGroupId ? findDrawerSplit(layout, drawerGroupId) : null
  if (found && drawerGroupId) {
    const collapsed = found.ratio >= TERMINAL_DRAWER_COLLAPSED_RATIO - 0.01
    if (collapsed) {
      state.setTabGroupSplitRatio(
        worktreeId,
        found.path.join('.'),
        openRatioByWorktree.get(worktreeId) ?? TERMINAL_DRAWER_OPEN_RATIO
      )
      state.focusGroup(worktreeId, drawerGroupId)
    } else {
      openRatioByWorktree.set(worktreeId, found.ratio)
      state.setTabGroupSplitRatio(worktreeId, found.path.join('.'), TERMINAL_DRAWER_COLLAPSED_RATIO)
    }
    return
  }
  const sourceGroupId = state.activeGroupIdByWorktree[worktreeId]
  if (!sourceGroupId) {
    return
  }
  state.createTab(worktreeId, sourceGroupId, undefined, {
    split: { sourceGroupId, splitDirection: 'down' }
  })
  const next = store.getState()
  const newGroupId = next.activeGroupIdByWorktree[worktreeId]
  const nextLayout = next.layoutByWorktree[worktreeId]
  const created = nextLayout && newGroupId ? findDrawerSplit(nextLayout, newGroupId) : null
  if (!created || !newGroupId) {
    return
  }
  drawerGroupByWorktree.set(worktreeId, newGroupId)
  next.setTabGroupSplitRatio(worktreeId, created.path.join('.'), TERMINAL_DRAWER_OPEN_RATIO)
}

export function resetTerminalDrawerForTests(): void {
  drawerGroupByWorktree.clear()
  openRatioByWorktree.clear()
}
