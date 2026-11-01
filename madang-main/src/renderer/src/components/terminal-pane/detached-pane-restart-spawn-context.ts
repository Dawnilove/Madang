import type { AppState } from '@/store'
import { getWorktreeMapFromState } from '@/store/selectors'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { selectFolderWorkspaces } from '@/store/workspace-record-selectors'

export function getWorkspacePath(state: AppState, worktreeId: string): string | null {
  const parsed = parseWorkspaceKey(worktreeId)
  return parsed?.type === 'folder'
    ? (selectFolderWorkspaces(state).find((workspace) => workspace.id === parsed.folderWorkspaceId)
        ?.folderPath ?? null)
    : (getWorktreeMapFromState(state).get(worktreeId)?.path ?? null)
}

export function buildPaneIdentityEnv(
  state: AppState,
  worktreeId: string,
  tabId: string,
  leafId: string
): Record<string, string> {
  const parsed = parseWorkspaceKey(worktreeId)
  const folderWorkspace =
    parsed?.type === 'folder'
      ? selectFolderWorkspaces(state).find((workspace) => workspace.id === parsed.folderWorkspaceId)
      : null
  return {
    MADANG_WORKSPACE_ID: worktreeId,
    ...(folderWorkspace
      ? {
          MADANG_PROJECT_GROUP_ID: folderWorkspace.projectGroupId,
          MADANG_WORKSPACE_ROOT: folderWorkspace.folderPath
        }
      : {}),
    MADANG_PANE_KEY: makePaneKey(tabId, leafId),
    MADANG_TAB_ID: tabId,
    MADANG_WORKTREE_ID: worktreeId
  }
}
