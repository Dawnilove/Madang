import type { AgentChatSessionsResult } from '../../../../shared/agent-chat-sessions'
import { AgentChatSessions } from '../../../../shared/rpc-contract/agent-chat-sessions-params'
import { summarizeChatSession } from '../../agent-chat-sessions'
import { defineMethod } from '../core'
import { requireInstalledStructuredHost } from './structured-agent-session-gate'

/** Used by `madang agent sessions` to show the chats with their real conversation names. */
export const AGENT_CHAT_SESSIONS_METHODS = [
  defineMethod({
    name: 'agent.chatSessions',
    permission: 'workspace',
    params: AgentChatSessions,
    handler: async (_params, ctx): Promise<AgentChatSessionsResult> => {
      const host = await requireInstalledStructuredHost(ctx)
      return { sessions: host.deps.store.listRecords().map(summarizeChatSession) }
    }
  })
]
