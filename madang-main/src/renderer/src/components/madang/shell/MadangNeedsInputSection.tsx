import React, { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import { useWorktreeActivityStatus } from '@/components/sidebar/use-worktree-activity-status'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import {
  flattenConversations,
  getConversationStatusTone,
  type FlatConversation,
  type ProjectConversations
} from './conversation-tree'
import { MadangConversationRow } from './MadangConversationRow'

// Why: the row's own status hook decides, so this section and the row badge can never disagree.
function NeedsInputRow({ node, repo }: FlatConversation): React.JSX.Element | null {
  const status = useWorktreeActivityStatus(node.worktree.id)
  if (getConversationStatusTone(status) !== 'needs-input') {
    return null
  }
  return (
    <MadangConversationRow
      node={node}
      depth={0}
      repo={repo}
      repoHostId={repo ? getRepoExecutionHostId(repo) : undefined}
    />
  )
}

/**
 * Conversations waiting for the user, repeated at the top of the list. They also stay under their
 * project. The section hides itself (CSS `:has`) while no row is waiting.
 */
export function MadangNeedsInputSection({
  projects
}: {
  projects: readonly ProjectConversations[]
}): React.JSX.Element {
  const conversations = useMemo(() => flattenConversations(projects), [projects])
  return (
    <section
      data-madang-needs-input-section=""
      className="mb-1 mt-1.5 hidden border-b border-worktree-sidebar-border pb-1 has-[[data-conversation-status=needs-input]]:block"
    >
      <div className="px-1 py-1 text-xs font-medium text-primary">
        {translate('madang.shell.needsInputSection', 'Waiting for you')}
      </div>
      <ul role="group" className="flex flex-col gap-px">
        {conversations.map(({ node, repo }) => (
          <NeedsInputRow key={node.worktree.id} node={node} repo={repo} />
        ))}
      </ul>
    </section>
  )
}
