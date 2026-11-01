import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import { countConversationNodes, type ProjectConversations } from './conversation-tree'
import { MadangConversationRow } from './MadangConversationRow'

/** A project heading with its conversations. Collapse state is per window session only. */
export function MadangConversationProject({
  project
}: {
  project: ProjectConversations
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const openModal = useAppStore((s) => s.openModal)
  const { repo, group } = project
  // Folder rows carry their own hostId, so a group-only section needs no project host.
  const repoHostId = repo ? getRepoExecutionHostId(repo) : undefined
  const count = countConversationNodes(project.conversations)
  const Chevron = collapsed ? ChevronRight : ChevronDown

  return (
    <section
      className="mt-1.5"
      data-madang-project-id={repo?.id}
      data-madang-project-group-id={group?.id}
    >
      <div className="group flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <Chevron className="size-3.5 shrink-0" />
          <span className="truncate">{repo?.displayName ?? group?.name}</span>
          <span className="shrink-0 tabular-nums opacity-70">{count}</span>
        </button>
        {repo ? (
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-worktree-sidebar-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={translate('madang.shell.newConversationInProject', 'New conversation here')}
            title={translate('madang.shell.newConversationInProject', 'New conversation here')}
            // Why: the composer accepts an initial project, so the "+" next to a project skips one pick.
            onClick={() =>
              openModal('new-workspace-composer', {
                initialRepoId: repo.id,
                telemetrySource: 'unknown'
              })
            }
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
      </div>
      {collapsed ? null : project.conversations.length === 0 ? (
        <p className="px-3 pb-1 text-xs text-muted-foreground">
          {translate('madang.shell.noConversations', 'No conversations yet.')}
        </p>
      ) : (
        <ul role="group" className="flex flex-col gap-px">
          {project.conversations.map((node) => (
            <MadangConversationRow
              key={node.worktree.id}
              node={node}
              depth={0}
              repo={project.repo}
              repoHostId={repoHostId}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
