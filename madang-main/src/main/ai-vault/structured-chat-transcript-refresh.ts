import type { RefreshDesktopChatArgs, RefreshDesktopChatResult } from '../../shared/ai-vault-types'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'
import { findResumeOwnership } from './structured-session-ownership'

/** Re-reads the Madang chat that owns this Claude session from its transcript, when the chat is at rest. */
export async function refreshStructuredChatFromTranscript(
  args: RefreshDesktopChatArgs | undefined
): Promise<RefreshDesktopChatResult> {
  if (typeof args?.sessionId !== 'string' || !args.sessionId) {
    return 'unreadable'
  }
  const host = getStructuredAgentSessionHost()
  const ownership = findResumeOwnership({
    agent: 'claude',
    sessionId: args.sessionId,
    filePath: ''
  })
  if (!host || !ownership) {
    return 'not-chat'
  }
  try {
    const transcriptPath = await resolveSessionFilePath('claude', ownership.providerSessionId)
    if (!transcriptPath) {
      return 'unreadable'
    }
    return await host.refreshAdoptedTranscript(ownership.sessionId, {
      providerSessionId: ownership.providerSessionId,
      transcriptPath
    })
  } catch (error) {
    console.warn('[desktop-sync] chat refresh failed', error instanceof Error ? error.message : '')
    return 'unreadable'
  }
}
