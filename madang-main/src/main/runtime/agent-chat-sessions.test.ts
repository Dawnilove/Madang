import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { summarizeChatSession } from './agent-chat-sessions'

const record = {
  sessionId: 'sess-1',
  provider: 'codex',
  conversationName: '  로그인 버그  ',
  location: { workspaceId: 'wt-1' },
  sleptAt: null,
  updatedAt: 123
} as unknown as AgentSessionRecord

describe('summarizeChatSession', () => {
  it('trims the conversation name and maps an empty one to null', () => {
    expect(summarizeChatSession(record).conversationName).toBe('로그인 버그')
    expect(
      summarizeChatSession({ ...record, conversationName: '  ' } as AgentSessionRecord)
        .conversationName
    ).toBeNull()
  })

  it('keeps the workspace and sleep state', () => {
    expect(summarizeChatSession(record)).toMatchObject({ workspaceId: 'wt-1', sleptAt: null })
  })
})
