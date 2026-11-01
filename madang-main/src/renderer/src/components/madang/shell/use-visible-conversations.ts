import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useRepoMap } from '@/store/selectors'
import { getSettingsFocusedExecutionHostId } from '../../../../../shared/execution-host'
import { getWorktreeHostIdentity } from '../../../../../shared/worktree/host-qualified-identity'
import { useSidebarWorktreeFilters } from '@/components/sidebar/worktree-list/listing/use-filters'
import { useSidebarWorktreeSortOrder } from '@/components/sidebar/worktree-list/listing/use-sort-order'
import { useVisibleSidebarWorktrees } from '@/components/sidebar/worktree-list/listing/use-visible-worktrees'
import { useAgentSendTargetWorktreeId } from '@/components/sidebar/worktree-list/listing/use-agent-send-target'

export type VisibleConversations = {
  /** Host identities (getWorktreeHostIdentity) that pass Orca's sidebar filters. */
  visibleHostIdentities: ReadonlySet<string>
  /** Orca's project filter; empty means every project. */
  filterRepoIds: readonly string[]
}

/**
 * Runs Orca's own sidebar visibility pipeline (the same hooks as its window list model) so the
 * conversation list hides exactly what Orca's workspace list hides. Why: the rules have many cases
 * (sleep sweep retention, paired devices, host scope); copying them would drift from upstream.
 */
export function useVisibleConversations(): VisibleConversations {
  const settings = useAppStore((s) => s.settings)
  const sortBy = useAppStore((s) => s.sortBy)
  const worktreeLineageById = useAppStore((s) => s.worktreeLineageById)
  const repoMap = useRepoMap()
  // Why: the list scope's default host is a sidebar filter input, the same read WorktreeList makes
  // (focus-setting-read-baseline.txt records it for this file).
  const defaultHostId = getSettingsFocusedExecutionHostId(settings)
  const agentSendTargetWorktreeId = useAgentSendTargetWorktreeId()
  const { filterState } = useSidebarWorktreeFilters()
  // Orca needs a rank list to filter; the conversation list applies its own order afterwards.
  const sortedIds = useSidebarWorktreeSortOrder({ repoMap, sortBy })
  const { visibleWorktrees } = useVisibleSidebarWorktrees({
    filterState,
    sortBy,
    sortedIds,
    repoMap,
    worktreeLineageById,
    defaultHostId,
    agentSendTargetWorktreeId
  })
  const visibleHostIdentities = useMemo(
    () => new Set(visibleWorktrees.map(getWorktreeHostIdentity)),
    [visibleWorktrees]
  )
  return { visibleHostIdentities, filterRepoIds: filterState.filterRepoIds }
}
