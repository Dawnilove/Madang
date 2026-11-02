import { describe, expect, it } from 'vitest'
import { buildFirstConversationChatRequest } from './first-conversation-chat-request'

describe('buildFirstConversationChatRequest', () => {
  it('asks the creation flow for a chat that already holds the typed request, with no shell startup', () => {
    const request = buildFirstConversationChatRequest({
      repoId: 'repo-1',
      agent: 'claude',
      text: '  fix the login bug  ',
      now: new Date(2026, 10, 2, 9, 5, 7),
      suffix: 'ab12'
    })
    expect(request).toMatchObject({
      repoId: 'repo-1',
      name: 'madang-20261102-090507-ab12',
      displayName: 'fix the login bug',
      agent: 'claude',
      agentLaunchRoute: 'structured-native-chat',
      quickPrompt: 'fix the login bug',
      promptDelivery: 'auto-submit',
      startupPlan: null
    })
    expect(request.startup).toBeUndefined()
  })
})
