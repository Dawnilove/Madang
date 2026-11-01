import React from 'react'
import { Workflow } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { activateWorktreeFromSidebar } from '@/lib/sidebar-worktree-activation'
import StatusIndicator from '@/components/sidebar/StatusIndicator'
import WorktreeCardAgents from '@/components/sidebar/WorktreeCardAgents'
import WorktreeContextMenu from '@/components/sidebar/WorktreeContextMenu'
import { useWorktreeActivityStatus } from '@/components/sidebar/use-worktree-activity-status'
import { useWorktreeAgentRows } from '@/components/sidebar/useWorktreeAgentRows'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { Repo } from '../../../../../shared/repo-types'
import { getConversationStatusTone, type ConversationNode } from './conversation-tree'
import { useMadangConversationTitle } from './use-madang-conversation-title'

type Props = {
  node: ConversationNode
  depth: number
  /** Undefined for a group-only section; the title lookup then skips GitHub. */
  repo: Repo | undefined
  /** The project's execution host; a worktree's own hostId wins when set. */
  repoHostId: ExecutionHostId | undefined
}

/** One conversation (= one workspace). Agent rows and child workspaces show under it. */
export const MadangConversationRow = React.memo(function MadangConversationRow({
  node,
  depth,
  repo,
  repoHostId
}: Props) {
  const { worktree } = node
  const title = useMadangConversationTitle(worktree, repo)
  const isActive = useAppStore((s) => s.activeWorktreeId === worktree.id)
  const status = useWorktreeActivityStatus(worktree.id)
  const tone = getConversationStatusTone(status)
  const hasAgents = useWorktreeAgentRows(worktree.id, true).length > 0

  return (
    <li role="none">
      {/* Why: Orca's card menu (rename, pin, sleep, delete, …) owns every workspace action, so the
          row reuses it whole. Only the row is wrapped; child rows carry their own menu scope. */}
      {/* Why: the row surface sits on this wrapper so the highlight spans `title | agents`; the button
          only owns the title. Agent pills are buttons themselves and cannot nest inside it. */}
      <div
        className={cn(
          'flex w-full min-w-0 items-start gap-0 rounded-md pr-2 text-sm transition-colors',
          isActive
            ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
            : 'text-worktree-sidebar-foreground hover:bg-worktree-sidebar-accent/60',
          worktree.isUnread && !isActive && 'font-semibold'
        )}
        // Why: indent children so orchestration workers read as part of their coordinator's conversation.
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {/* Why: Orca's card menu (rename, pin, sleep, delete, …) owns every workspace action, so the
            row reuses it whole. Only the row is wrapped; child rows carry their own menu scope. */}
        <WorktreeContextMenu worktree={worktree}>
          <button
            type="button"
            role="option"
            aria-selected={isActive}
            data-conversation-id={worktree.id}
            data-conversation-status={tone}
            // Why: same entry point as Orca's workspace card, so the open conversation gets its default
            // chat surface, navigation history and VM wake exactly like a sidebar click.
            onClick={() =>
              void activateWorktreeFromSidebar(worktree.id, worktree.hostId ?? repoHostId)
            }
            className={cn(
              'flex min-w-0 items-center gap-2 py-1.5 text-left',
              // Why: with agents the title is a fixed-width label so every agent list starts at the same x.
              hasAgents ? 'h-8 w-20 shrink-0 text-[11px] text-muted-foreground' : 'flex-1'
            )}
          >
            <StatusIndicator status={status} tooltipSide="right" aria-hidden="true" />
            {node.createdByOrchestration ? (
              <Workflow
                className="size-3 shrink-0 text-muted-foreground"
                aria-label={translate('madang.shell.orchestrationWorker', 'Orchestration worker')}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {tone === 'needs-input' ? (
              <span className="shrink-0 rounded bg-primary/15 px-1.5 text-[11px] text-primary">
                {translate('madang.shell.needsInput', 'Needs input')}
              </span>
            ) : null}
          </button>
        </WorktreeContextMenu>
        {/* Why: the agent list (with subagent lineage) is Orca's own card body; it renders nothing
            for a conversation without agents, so every row can show its agents at a glance. */}
        {hasAgents ? (
          <div className="ml-3 min-w-0 flex-1 py-1">
            <WorktreeCardAgents worktreeId={worktree.id} className="mt-0" />
          </div>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul role="group" className="flex flex-col">
          {node.children.map((child) => (
            <MadangConversationRow
              key={child.worktree.id}
              node={child}
              depth={depth + 1}
              repo={repo}
              repoHostId={repoHostId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
})
