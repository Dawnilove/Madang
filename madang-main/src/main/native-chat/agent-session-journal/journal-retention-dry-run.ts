// Company-edition retention, stage 0 (docs/분석/27): count what an age-based cleanup WOULD delete.
// Read-only. Nothing is deleted and no setting exists yet.

import type Database from '../../sqlite/sync-database'
import type { AgentSessionLease } from '../../../shared/agent-session-record'
import {
  agentSessionLeaseIsReleased,
  agentSessionLeaseOwnerVerdict
} from '../../../shared/agent-session-lease-adjudication'
import { isCompanyEdition } from '../../../shared/madang-edition'
import type { JournalHostDatabase } from './journal-host-database'
import type { StructuredAgentSessionLogger } from '../agent-session-wire/structured-agent-session-logger'

const DAY_MS = 24 * 60 * 60 * 1000
const START_DELAY_MS = 60_000
/** Stage 0 only: the dry-run runs when this variable holds a day count. */
export const RETENTION_DRY_RUN_ENV = 'MADANG_RETENTION_DRYRUN_DAYS'

export type RetentionDryRunSkipCounts = {
  openTab: number
  running: number
  queuedMessages: number
  sleeping: number
  recent: number
  unreadable: number
}

export type RetentionDryRunResult = {
  /** Sessions that stage 1 would delete. */
  sessions: number
  /** Their ids, for the real cleanup. */
  sessionIds: string[]
  /** `journal_rows` rows that go with them. */
  journalRows: number
  /** Sessions kept, by the first rule that kept them. */
  kept: RetentionDryRunSkipCounts
}

type StoredRecord = { lease?: AgentSessionLease; createdAt?: number; sleptAt?: number }

export function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  )
}

function sessionIdSet(db: Database.Database, table: string, column: string): Set<string> {
  if (!tableExists(db, table)) {
    return new Set()
  }
  const ids = new Set<string>()
  for (const row of db.prepare(`SELECT DISTINCT ${column} AS id FROM ${table}`).all()) {
    if (typeof row.id === 'string') {
      ids.add(row.id)
    }
  }
  return ids
}

/** Same verdict as `forgetExitedAgentSessionRecord`: exited owner, or a chat no process ever ran. */
export function ownerGone(persisted: AgentSessionLease): boolean {
  // The persisted lease is unreconciled on load; judge its stored fields.
  const lease = { ...persisted, unreconciled: false }
  const neverRan =
    agentSessionLeaseIsReleased(lease) &&
    lease.ownerProcess === null &&
    lease.reservedSpawnToken === null &&
    lease.provenHandleLinkId === null
  return agentSessionLeaseOwnerVerdict(lease) === 'exited' || neverRan
}

/** Last activity = the later of the record's `createdAt` and its newest journal row. Not `updatedAt`: every app start rewrites it. */
/** Newest journal row time of one session; 0 when it has none. */
export function lastJournalTs(db: Database.Database, sessionId: string): number {
  if (!tableExists(db, 'journal_rows')) {
    return 0
  }
  const row = db
    .prepare('SELECT MAX(ts) AS lastTs FROM journal_rows WHERE session_id = ?')
    .get(sessionId)
  return Number(row?.lastTs ?? 0)
}

export function planRetentionCleanup(
  db: Database.Database,
  options: { retentionDays: number; now: number }
): RetentionDryRunResult {
  const cutoff = options.now - options.retentionDays * DAY_MS
  const result: RetentionDryRunResult = {
    sessions: 0,
    sessionIds: [],
    journalRows: 0,
    kept: { openTab: 0, running: 0, queuedMessages: 0, sleeping: 0, recent: 0, unreadable: 0 }
  }
  if (!tableExists(db, 'agent_session_records')) {
    return result
  }
  const openTabs = sessionIdSet(db, 'agent_session_tabs', 'session_id')
  const queued = sessionIdSet(db, 'queued_messages', 'session_id')
  const journal = new Map<string, { lastTs: number; rows: number }>()
  if (tableExists(db, 'journal_rows')) {
    for (const row of db
      .prepare(
        'SELECT session_id AS id, MAX(ts) AS lastTs, COUNT(*) AS rows FROM journal_rows GROUP BY session_id'
      )
      .all()) {
      journal.set(String(row.id), { lastTs: Number(row.lastTs), rows: Number(row.rows) })
    }
  }
  for (const row of db.prepare('SELECT session_id, record_json FROM agent_session_records').all()) {
    const sessionId = String(row.session_id)
    let record: StoredRecord
    try {
      record = JSON.parse(String(row.record_json)) as StoredRecord
    } catch {
      result.kept.unreadable += 1
      continue
    }
    if (!record.lease || !Number.isFinite(record.createdAt)) {
      result.kept.unreadable += 1
    } else if (openTabs.has(sessionId)) {
      result.kept.openTab += 1
    } else if (!ownerGone(record.lease)) {
      result.kept.running += 1
    } else if (queued.has(sessionId)) {
      result.kept.queuedMessages += 1
    } else if (typeof record.sleptAt === 'number') {
      result.kept.sleeping += 1
    } else {
      const rows = journal.get(sessionId)
      const lastActivity = Math.max(record.createdAt as number, rows?.lastTs ?? 0)
      if (lastActivity >= cutoff) {
        result.kept.recent += 1
      } else {
        result.sessions += 1
        result.sessionIds.push(sessionId)
        result.journalRows += rows?.rows ?? 0
      }
    }
  }
  return result
}

/** Stage 0 hook: in the company edition with the env variable set, log the counts once after startup. */
export function scheduleRetentionDryRun(
  database: JournalHostDatabase,
  logger: StructuredAgentSessionLogger
): void {
  const days = Number(process.env[RETENTION_DRY_RUN_ENV])
  if (!isCompanyEdition() || !Number.isInteger(days) || days < 1) {
    return
  }
  setTimeout(() => {
    try {
      if (database.isClosed) {
        return
      }
      const { sessions, journalRows, kept } = planRetentionCleanup(database.db, {
        retentionDays: days,
        now: Date.now()
      })
      // Counts only; no conversation content.
      logger.warn('retention dry-run (nothing deleted)', {
        scope: 'retention-dry-run',
        days,
        sessions,
        journalRows,
        kept
      })
    } catch (error) {
      logger.warn('retention dry-run failed', { scope: 'retention-dry-run', error })
    }
  }, START_DELAY_MS).unref()
}
