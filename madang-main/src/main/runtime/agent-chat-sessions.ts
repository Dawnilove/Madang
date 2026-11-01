import type { AgentChatSessionSummary } from '../../shared/agent-chat-sessions'
import type { AgentSessionRecord } from '../../shared/agent-session-record'

export function summarizeChatSession(record: AgentSessionRecord): AgentChatSessionSummary {
  const name = record.conversationName?.trim()
  return {
    sessionId: record.sessionId,
    provider: record.provider,
    conversationName: name ? name : null,
    workspaceId: record.location.workspaceId,
    sleptAt: record.sleptAt ?? null,
    updatedAt: record.updatedAt
  }
}
