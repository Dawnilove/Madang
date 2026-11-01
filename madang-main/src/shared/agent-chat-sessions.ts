export type AgentChatSessionSummary = {
  sessionId: string
  provider: string
  /** The conversation's own name (the title at the top of its chat); null while it has none. */
  conversationName: string | null
  workspaceId: string
  sleptAt: number | null
  updatedAt: number
}

export type AgentChatSessionsResult = { sessions: AgentChatSessionSummary[] }
