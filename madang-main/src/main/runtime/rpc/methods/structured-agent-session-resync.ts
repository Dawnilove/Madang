// Replace the visible history with the provider's saved transcript; refused while the chat works.

import { defineMethod } from '../core'
import { requireInstalledStructuredHost } from './structured-agent-session-gate'
import { OptionsParams } from './structured-agent-session-schemas'

export const STRUCTURED_AGENT_SESSION_RESYNC_METHODS = [
  defineMethod({
    name: 'agentSession.resyncFromTranscript',
    permission: 'workspace',
    params: OptionsParams,
    handler: async (params, ctx) => {
      const host = await requireInstalledStructuredHost(ctx, params.sessionId)
      return host.resyncFromTranscript(params.sessionId)
    }
  })
]
