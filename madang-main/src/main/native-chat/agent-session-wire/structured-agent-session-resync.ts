// Re-read the provider's own transcript and replace the visible history with it.

import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { prepareLegacyTranscriptImport } from '../agent-session-journal/journal-legacy-import'
import { resolveSessionFilePath } from '../session-file-resolver'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { hostStructuredAgentSessionCurrentWork } from './structured-agent-session-host-current-work'
import type { StructuredAgentSessionConversationLifetime } from './structured-agent-session-conversation-lifetime'
import type { StructuredAgentSessionConversations } from './structured-agent-session-conversations'

export type StructuredAgentSessionResyncResult =
  | { ok: true; imported: number }
  | {
      ok: false
      reason: 'no-session' | 'busy' | 'transcript-missing' | 'transcript-empty' | 'import-failed'
      message?: string
    }

export type StructuredAgentSessionResyncHost = {
  getRecord: (sessionId: string) => AgentSessionRecord | undefined | null
  /** Opens the conversation at rest when needed; call outside serialize, which it uses itself. */
  openSession: (sessionId: string) => Promise<{
    journal: AgentSessionJournal
    inspect: () => { hasChild: boolean; working: boolean }
  }>
  /** Stops an idle child at rest, as idle eviction does; runs inside serialize. */
  stopIdleChild: (sessionId: string) => Promise<void>
  serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
  resolveTranscript?: typeof resolveSessionFilePath
}

/** Working chats are refused; an idle child is stopped first because it holds its own copy of the conversation. */
export function resyncStructuredAgentSessionFromTranscript(
  host: StructuredAgentSessionResyncHost,
  sessionId: string
): Promise<StructuredAgentSessionResyncResult> {
  const record = host.getRecord(sessionId)
  if (!record || !record.providerHandleChain.at(-1)) {
    return Promise.resolve({ ok: false, reason: 'no-session' })
  }
  return host.openSession(sessionId).then(({ journal, inspect }) =>
    host.serialize(sessionId, async () => {
      const current = host.getRecord(sessionId)
      const link = current?.providerHandleChain.at(-1)
      if (!current || !link) {
        return { ok: false, reason: 'no-session' }
      }
      if (inspect().working) {
        return { ok: false, reason: 'busy' }
      }
      if (inspect().hasChild) {
        await host.stopIdleChild(sessionId)
        if (inspect().working || inspect().hasChild) {
          return { ok: false, reason: 'busy' }
        }
      }
      const { agent, nativeId } = link.handle
      const filePath = await (host.resolveTranscript ?? resolveSessionFilePath)(agent, nativeId, {
        wslDistro: current.location.wslDistro ?? undefined
      })
      if (!filePath) {
        return { ok: false, reason: 'transcript-missing' }
      }
      const prepared = await prepareLegacyTranscriptImport({
        agent,
        sessionId: nativeId,
        options: { filePath }
      })
      if (!prepared.ok) {
        return { ok: false, reason: 'import-failed', message: prepared.error }
      }
      // An empty read must never wipe a visible history.
      if (prepared.items.length === 0) {
        return { ok: false, reason: 'transcript-empty' }
      }
      await journal.replaceEpochItems('legacy_import', current.lease.runtimeFence, prepared.items)
      return { ok: true, imported: prepared.items.length }
    })
  )
}

/** Binds the resync steps to a live host's store, open conversations and lifetime. */
export function resyncHostedStructuredAgentSession(
  host: {
    store: AgentSessionRecordStore
    sessions: StructuredAgentSessionConversations
    lifetime: StructuredAgentSessionConversationLifetime
    serialize: StructuredAgentSessionResyncHost['serialize']
  },
  sessionId: string
): Promise<StructuredAgentSessionResyncResult> {
  return resyncStructuredAgentSessionFromTranscript(
    {
      getRecord: (id) => host.store.getRecord(id),
      openSession: async (id) => {
        const session = await host.lifetime.conversation(id)
        return {
          journal: session.journal,
          inspect: () => ({
            hasChild: Boolean(host.sessions.get(id)?.child),
            working:
              hostStructuredAgentSessionCurrentWork(
                { store: host.store, sessions: host.sessions },
                id
              )?.working() ?? false
          })
        }
      },
      stopIdleChild: async (id) => {
        await host.lifetime.stopAgent(id, { cause: 'evict', resting: true })
      },
      serialize: host.serialize
    },
    sessionId
  )
}
