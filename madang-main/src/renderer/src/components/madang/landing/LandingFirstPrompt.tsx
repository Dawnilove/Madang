import React, { useMemo, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { startFirstConversation } from './first-conversation'
import { buildFirstConversationChatRequest } from './first-conversation-chat-request'
import { resolveAgentSessionLaunchRoute } from '@/lib/agent-session-launch-plan'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'

const AGENT_CHOICES: readonly TuiAgent[] = ['claude', 'codex']

/** "What should we do?" box on the first screen: one typed request creates the workspace and starts the agent. */
export function LandingFirstPrompt(): React.JSX.Element | null {
  const repos = useAppStore((s) => s.repos)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const defaultTuiAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const createWorktree = useAppStore((s) => s.createWorktree)
  const gitRepos = useMemo(() => repos.filter(isGitRepoKind), [repos])
  const [pickedRepoId, setPickedRepoId] = useState<string | null>(null)
  const [pickedAgent, setPickedAgent] = useState<TuiAgent | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const repoId =
    gitRepos.find((repo) => repo.id === pickedRepoId)?.id ??
    gitRepos.find((repo) => repo.id === activeRepoId)?.id ??
    gitRepos[0]?.id
  const agent =
    pickedAgent ?? AGENT_CHOICES.find((choice) => choice === defaultTuiAgent) ?? AGENT_CHOICES[0]
  if (!repoId) {
    return null
  }

  const submit = async (): Promise<void> => {
    if (busy || text.trim().length === 0) {
      return
    }
    setBusy(true)
    try {
      // Chat route: let the creation flow open the chat as the first tab. Creating first and launching
      // afterwards put an idle shell terminal in front of the chat.
      const route = resolveAgentSessionLaunchRoute(useAppStore.getState(), {
        agent,
        workspace: { kind: 'git-worktree', repoId },
        prompt: text.trim(),
        promptDelivery: 'auto-submit'
      })
      if (route === 'structured-native-chat') {
        runBackgroundWorktreeCreation(
          buildFirstConversationChatRequest({
            repoId,
            agent,
            text,
            now: new Date(),
            suffix: createBrowserUuid().slice(0, 4)
          })
        )
        setText('')
        return
      }
      const result = await startFirstConversation(
        { repoId, agent, text },
        {
          createWorktree: async (id, name, displayName) => {
            const created = await createWorktree(
              id,
              name,
              undefined,
              undefined,
              undefined,
              'unknown',
              displayName
            )
            return created?.worktree ?? null
          },
          activateWorktree: (worktreeId) => void activateAndRevealWorktree(worktreeId),
          launchAgent: ({ worktreeId, agent: launchAgent, prompt }) =>
            void launchAgentInNewTab({
              requestId: newAgentLaunchRequestId(),
              agent: launchAgent,
              worktreeId,
              prompt,
              promptDelivery: 'auto-submit'
            }),
          now: () => new Date(),
          newSuffix: () => createBrowserUuid().slice(0, 4)
        }
      )
      if (result.ok) {
        setText('')
      } else if (result.reason === 'create-failed') {
        toast.error(
          translate('madang.landing.firstPrompt.createFailed', 'Could not create the workspace.'),
          result.message ? { description: result.message } : undefined
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 w-full space-y-2" data-madang-first-prompt="">
      <Textarea
        value={text}
        disabled={busy}
        rows={3}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends; Shift+Enter adds a line; a Korean syllable still being composed must not send.
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder={translate('madang.landing.firstPrompt.placeholder', 'What should we do?')}
        aria-label={translate('madang.landing.firstPrompt.placeholder', 'What should we do?')}
        className="resize-none"
      />
      <div className="flex items-center gap-2">
        <Select value={repoId} onValueChange={setPickedRepoId}>
          <SelectTrigger
            size="sm"
            className="min-w-0 flex-1"
            aria-label={translate('madang.landing.firstPrompt.project', 'Project')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {gitRepos.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                {repo.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={agent}
          onValueChange={(value) =>
            setPickedAgent(AGENT_CHOICES.find((choice) => choice === value) ?? null)
          }
        >
          <SelectTrigger
            size="sm"
            className="w-28"
            aria-label={translate('madang.landing.firstPrompt.agent', 'Agent')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGENT_CHOICES.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          disabled={busy || text.trim().length === 0}
          onClick={() => void submit()}
        >
          <ArrowUp className="size-3.5" />
          {translate('madang.landing.firstPrompt.start', 'Start')}
        </Button>
      </div>
    </div>
  )
}
