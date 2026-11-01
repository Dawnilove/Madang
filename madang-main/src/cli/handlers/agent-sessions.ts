import type { CommandHandler } from '../dispatch'
import type { AgentChatSessionsResult } from '../../shared/agent-chat-sessions'
import { formatOrcaSessionAddress, isOrcaSessionId } from '../../shared/madang-session-address'

export const AGENT_SESSIONS_HANDLERS: Record<string, CommandHandler> = {
  'agent sessions': async ({ client, json }) => {
    const { result } = await client.call<AgentChatSessionsResult>('agent.chatSessions', {})
    if (json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (result.sessions.length === 0) {
      console.log('No chat sessions.')
      return
    }
    for (const session of result.sessions) {
      const address = isOrcaSessionId(session.sessionId)
        ? formatOrcaSessionAddress(session.sessionId)
        : session.sessionId
      const title = session.conversationName ?? '(untitled)'
      const state = session.sleptAt ? ' · asleep' : ''
      console.log(`${address} · ${title} · ${session.provider} · ${session.workspaceId}${state}`)
    }
  }
}
