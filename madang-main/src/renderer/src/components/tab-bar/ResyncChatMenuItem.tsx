import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import { resyncStructuredAgentSessionFromTranscript } from '@/runtime/structured-agent-session-client'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'

function failureText(reason: string): string {
  switch (reason) {
    case 'busy':
      return translate(
        'components.tab.bar.ResyncChatMenuItem.busy',
        'This chat is running. Try again when it is idle.'
      )
    case 'no-session':
      return translate(
        'components.tab.bar.ResyncChatMenuItem.notHere',
        'This chat is not on this computer, so it cannot be reloaded here.'
      )
    case 'transcript-missing':
    case 'transcript-empty':
      return translate(
        'components.tab.bar.ResyncChatMenuItem.noTranscript',
        'No saved conversation was found to reload.'
      )
    default:
      return translate('components.tab.bar.ResyncChatMenuItem.failed', 'Could not reload the chat.')
  }
}

/** Reload this chat's history from the provider's saved conversation, after the user confirms. */
export function ResyncChatMenuItem({ sessionId }: { sessionId: string }): React.JSX.Element {
  const resync = async (): Promise<void> => {
    const confirmed = window.confirm(
      translate(
        'components.tab.bar.ResyncChatMenuItem.confirm',
        'Reload this chat from the original conversation? Items that exist only in Madang may disappear.'
      )
    )
    const target = structuredAgentSessionTargetForHost(LOCAL_EXECUTION_HOST_ID)
    if (!confirmed || !target) {
      return
    }
    const outcome = await resyncStructuredAgentSessionFromTranscript(target, sessionId)
    if (outcome.ok) {
      toast.success(translate('components.tab.bar.ResyncChatMenuItem.done', 'Chat reloaded'))
    } else {
      toast.error(failureText(outcome.reason))
    }
  }

  return (
    <DropdownMenuItem onSelect={() => void resync()}>
      <RefreshCw className="size-3.5" />
      {translate('components.tab.bar.ResyncChatMenuItem.label', 'Reload from Original')}
    </DropdownMenuItem>
  )
}
