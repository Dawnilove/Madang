// Company-edition retention, stage 1 (docs/분석/27): delete chat copies idle longer than the chosen days.
// Runs once after startup. Irreversible, so every session is re-checked against live state first.

import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { isCompanyEdition } from '../../../shared/madang-edition'
import { normalizeSessionRetentionDays } from '../../../shared/session-retention-settings'
import type { StructuredAgentSessionLogger } from '../agent-session-wire/structured-agent-session-logger'
import type { JournalHostDatabase } from './journal-host-database'
import {
  lastJournalTs,
  ownerGone,
  planRetentionCleanup,
  tableExists
} from './journal-retention-dry-run'

const DAY_MS = 24 * 60 * 60 * 1000
const START_DELAY_MS = 60_000
/** Short DB lock per run; the rest waits for the next run. */
export const RETENTION_BATCH_LIMIT = 50

// Tables keyed by session_id. The record row goes last, through the store, so memory and DB agree.
const SESSION_TABLES = [
  'journal_rows',
  'journal_sessions',
  'journal_imports',
  'journal_repairs',
  'journal_set_aside',
  'queued_messages',
  'agent_session_command_receipts'
] as const

export type RetentionCleanupResult = { sessions: number; journalRows: number }

/**
 * Journal tables go first, then the record. A crash between leaves an empty chat that the next run
 * deletes, never an orphan row nothing would find.
 */
export async function runRetentionCleanup(args: {
  store: AgentSessionRecordStore
  database: JournalHostDatabase
  retentionDays: number
  now: number
  limit?: number
}): Promise<RetentionCleanupResult> {
  const { store, database, retentionDays, now } = args
  const cutoff = now - retentionDays * DAY_MS
  const plan = planRetentionCleanup(database.db, { retentionDays, now })
  const candidates = plan.sessionIds.slice(0, args.limit ?? RETENTION_BATCH_LIMIT)
  if (candidates.length === 0) {
    return { sessions: 0, journalRows: 0 }
  }
  let journalRows = 0
  const purged = await store.purgeRecordsWhere(
    candidates,
    // Live state, not the plan: a chat opened or woken since the plan is kept.
    (record, draft) =>
      !draft.sessionTabs?.tabIdFor(record.sessionId) &&
      ownerGone(record.lease) &&
      record.sleptAt === undefined &&
      Math.max(record.createdAt, lastJournalTs(database.db, record.sessionId)) < cutoff &&
      !hasQueuedMessages(database, record.sessionId),
    (sessionId) => {
      database.transaction((db) => {
        for (const table of SESSION_TABLES) {
          if (tableExists(db, table)) {
            const { changes } = db
              .prepare(`DELETE FROM ${table} WHERE session_id = ?`)
              .run(sessionId)
            journalRows += table === 'journal_rows' ? Number(changes) : 0
          }
        }
      })
    }
  )
  if (purged.length > 0) {
    database.db.exec('PRAGMA incremental_vacuum')
  }
  return { sessions: purged.length, journalRows }
}

function hasQueuedMessages(database: JournalHostDatabase, sessionId: string): boolean {
  const { db } = database
  return (
    tableExists(db, 'queued_messages') &&
    Boolean(
      db
        .prepare('SELECT 1 AS present FROM queued_messages WHERE session_id = ? LIMIT 1')
        .get(sessionId)
    )
  )
}

let scheduled = false

/** Company edition only; `readDays` is read when the timer fires so a late settings load still counts. */
export function scheduleRetentionCleanup(args: {
  store: AgentSessionRecordStore
  database: JournalHostDatabase
  readDays: () => unknown
  logger: StructuredAgentSessionLogger
}): void {
  if (!isCompanyEdition() || scheduled) {
    return
  }
  scheduled = true
  setTimeout(() => {
    const retentionDays = normalizeSessionRetentionDays(args.readDays())
    if (retentionDays === null || args.database.isClosed) {
      return
    }
    runRetentionCleanup({ ...args, retentionDays, now: Date.now() }).then(
      ({ sessions, journalRows }) =>
        // Counts only; no conversation content.
        args.logger.warn('retention cleanup done', {
          scope: 'retention-cleanup',
          retentionDays,
          sessions,
          journalRows
        }),
      (error) => args.logger.warn('retention cleanup failed', { scope: 'retention-cleanup', error })
    )
  }, START_DELAY_MS).unref()
}
