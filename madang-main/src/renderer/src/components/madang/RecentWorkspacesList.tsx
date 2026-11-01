import { useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useAllWorktrees, useRepos } from '@/store/selectors'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { getPaletteWorktreeExecutionHostId } from '@/lib/palette-repo-resolution'
import { getWorktreeVisitTimestamp } from '@/lib/worktree-visit-recency'
import { translate } from '@/i18n/i18n'
import type { Worktree } from '../../../../shared/worktree/types'

const MAX_RECENT_WORKSPACES = 5

function openWorkspace(worktree: Worktree): void {
  const executionHostId = getPaletteWorktreeExecutionHostId(worktree)
  const current = useAppStore.getState().getKnownWorktreeById(worktree.id, executionHostId)
  if (!current) {
    toast.error(
      translate('auto.components.WorktreeJumpPalette.2c38630a01', 'Workspace no longer exists')
    )
    return
  }
  activateAndRevealWorkspace(worktree.id, {
    navigationIntent: 'user-open',
    ...(executionHostId ? { executionHostId } : {})
  })
}

/** Start-screen shortcut back into the last few workspaces, newest first. */
export function RecentWorkspacesList(): React.JSX.Element | null {
  const worktrees = useAllWorktrees()
  const repos = useRepos()
  const visits = useAppStore((s) => s.lastVisitedAtByWorktreeId)

  const recent = useMemo(() => {
    const score = (worktree: Worktree): number =>
      getWorktreeVisitTimestamp(visits, worktree) ?? worktree.lastActivityAt ?? 0
    return worktrees
      .filter((worktree) => !worktree.isArchived)
      .slice()
      .sort((a, b) => score(b) - score(a))
      .slice(0, MAX_RECENT_WORKSPACES)
  }, [visits, worktrees])

  const repoNameById = useMemo(
    () => new Map(repos.map((repo) => [repo.id, repo.displayName])),
    [repos]
  )

  if (recent.length === 0) {
    return null
  }

  return (
    <div className="w-full">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {translate('madang.landing.recentWorkspaces', 'Recent workspaces')}
      </div>
      <div className="flex flex-col overflow-hidden rounded-md border border-border">
        {recent.map((worktree) => (
          <button
            key={worktree.id}
            type="button"
            onClick={() => openWorkspace(worktree)}
            className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-foreground">{worktree.displayName}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">
              {repoNameById.get(worktree.repoId) ?? ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
