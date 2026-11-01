// Re-read an adopted chat's provider transcript after another app (the Claude desktop app) appended to it.
// Only a chat at rest: stop its child so the next send resumes the fresh file, then replace the journal.

import type { AgentType } from '../../../shared/agent-status-types'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { importLegacyTranscriptIntoJournal } from '../agent-session-journal/journal-legacy-import'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'

export type AdoptedTranscriptRefresh = 'refreshed' | 'busy' | 'unreadable'

export type AdoptedTranscriptRefreshContext = {
  store: Pick<AgentSessionRecordStore, 'getRecord'>
  sessions: ReadonlyMap<string, StructuredAgentSessionHostSession>
  serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
  /** Opens the conversation at rest; it serializes itself, so call it outside `serialize`. */
  conversation: (sessionId: string) => Promise<StructuredAgentSessionHostSession>
  owesWork: (sessionId: string, session: StructuredAgentSessionHostSession) => boolean
  /** Already inside session serialization. */
  stopAgent: (sessionId: string) => Promise<void>
}

export async function refreshAdoptedStructuredAgentSession(
  context: AdoptedTranscriptRefreshContext,
  sessionId: string,
  source: { providerSessionId: string; transcriptPath: string }
): Promise<AdoptedTranscriptRefresh> {
  if (!context.store.getRecord(sessionId)) {
    return 'unreadable'
  }
  await context.conversation(sessionId)
  return context.serialize(sessionId, async () => {
    const session = context.sessions.get(sessionId)
    const record = context.store.getRecord(sessionId)
    if (!session || !record) {
      return 'unreadable'
    }
    // Same test the idle sweep uses before it retires a child: any owed work keeps the chat as it is.
    if (session.child?.phase === 'starting' || context.owesWork(sessionId, session)) {
      return 'busy'
    }
    // A live child holds the old context; the next send starts a new one that resumes the fresh file.
    if (session.child) {
      await context.stopAgent(sessionId)
    }
    const fence = context.store.getRecord(sessionId)?.lease.runtimeFence
    if (fence === undefined) {
      return 'unreadable'
    }
    // An unreadable or empty transcript leaves the journal untouched.
    const imported = await importLegacyTranscriptIntoJournal({
      journal: session.journal,
      agent: record.provider as AgentType,
      sessionId: source.providerSessionId,
      fence,
      options: { filePath: source.transcriptPath }
    })
    return imported.ok && imported.replaced ? 'refreshed' : 'unreadable'
  })
}
