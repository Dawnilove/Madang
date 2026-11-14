import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../shared/agent-session-record.test-fixture'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import {
  openTestAgentSessionRecordStore,
  seedTestAgentSessionRecordStore
} from '../../runtime/agent-session-record-store-test-harness'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from './journal-host-database-test-support'
import { runRetentionCleanup } from './journal-retention-cleanup'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000
const OLD = NOW - 200 * DAY
const RECENT = NOW - 5 * DAY

let directory: string

function session(
  id: string,
  options: { createdAt?: number; live?: boolean; sleptAt?: number } = {}
): AgentSessionRecord {
  const lease = options.live
    ? agentSessionLeaseFixture({ sessionId: id })
    : agentSessionLeaseFixture({
        sessionId: id,
        ownerProcess: null,
        reservedSpawnToken: null,
        claimStatus: 'released',
        deathEvidence: { kind: 'exit-observed', detail: 'gone', observedAt: 5_000 }
      })
  return {
    ...agentSessionRecordFixture(lease),
    sessionId: id,
    createdAt: options.createdAt ?? OLD,
    updatedAt: NOW, // an app start rewrites it; retention must ignore it
    ...(options.sleptAt === undefined ? {} : { sleptAt: options.sleptAt })
  }
}

async function setup(
  records: AgentSessionRecord[],
  sessionTabs: { tabId: string; sessionId: string }[] = []
) {
  await seedTestAgentSessionRecordStore(directory, { records, sessionTabs })
  const database = openTestJournalHostDatabase(directory)
  database.transaction((db) => {
    for (const { sessionId } of records) {
      db.prepare('INSERT INTO journal_sessions VALUES (?, ?, ?)').run(sessionId, 'ws', 'e')
      for (const seq of [1, 2]) {
        db.prepare('INSERT INTO journal_rows VALUES (?, ?, ?, ?, ?)').run(
          sessionId,
          'e',
          seq,
          OLD,
          '{}'
        )
      }
    }
  })
  const store = await openTestAgentSessionRecordStore(directory)
  return { database, store }
}

const rowCount = (database: ReturnType<typeof openTestJournalHostDatabase>, table: string) =>
  Number(database.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'madang-retention-'))
})

afterEach(async () => {
  closeTestJournalHostDatabase(directory)
  await rm(directory, { recursive: true, force: true })
})

describe('runRetentionCleanup', () => {
  it('deletes old chats from every table and from memory, and keeps the rest', async () => {
    const { database, store } = await setup(
      [
        session('session-old'),
        session('session-recent', { createdAt: RECENT }),
        session('session-live', { live: true }),
        session('session-tabbed'),
        session('session-asleep', { sleptAt: OLD })
      ],
      [{ tabId: 't1', sessionId: 'session-tabbed' }]
    )
    database.transaction((db) => {
      db.prepare(
        'INSERT INTO queued_messages (session_id, message_id, position, body_json, fingerprint, created_at, host_instance, state) VALUES (?, ?, 0, ?, ?, 0, ?, ?)'
      ).run('session-recent', 'm', '{}', 'f', 'h', 'queued')
    })

    const result = await runRetentionCleanup({ store, database, retentionDays: 90, now: NOW })

    expect(result).toEqual({ sessions: 1, journalRows: 2 })
    expect(store.getRecord('session-old')).toBeNull()
    for (const id of ['session-recent', 'session-live', 'session-tabbed', 'session-asleep']) {
      expect(store.getRecord(id)).not.toBeNull()
    }
    expect(rowCount(database, 'agent_session_records')).toBe(4)
    expect(rowCount(database, 'journal_rows')).toBe(8)
    expect(rowCount(database, 'journal_sessions')).toBe(4)
    expect(
      database.db.prepare("SELECT 1 FROM journal_rows WHERE session_id = 'session-old'").get()
    ).toBeUndefined()
  })

  it('deletes at most the batch limit and finishes on the next run', async () => {
    const { database, store } = await setup([
      session('session-a'),
      session('session-b'),
      session('session-c')
    ])
    const first = await runRetentionCleanup({
      store,
      database,
      retentionDays: 90,
      now: NOW,
      limit: 2
    })
    expect(first.sessions).toBe(2)
    expect(rowCount(database, 'agent_session_records')).toBe(1)
    const second = await runRetentionCleanup({
      store,
      database,
      retentionDays: 90,
      now: NOW,
      limit: 2
    })
    expect(second.sessions).toBe(1)
    expect(rowCount(database, 'agent_session_records')).toBe(0)
    expect(rowCount(database, 'journal_rows')).toBe(0)
  })

  it('stays deleted after the store reopens', async () => {
    const { database, store } = await setup([
      session('session-old'),
      session('session-recent', { createdAt: RECENT })
    ])
    await runRetentionCleanup({ store, database, retentionDays: 90, now: NOW })
    const reopened = await openTestAgentSessionRecordStore(directory)
    expect(reopened.getRecord('session-old')).toBeNull()
    expect(reopened.getRecord('session-recent')).not.toBeNull()
  })

  it('deletes nothing when no chat is old enough', async () => {
    const { database, store } = await setup([session('session-recent', { createdAt: RECENT })])
    expect(await runRetentionCleanup({ store, database, retentionDays: 90, now: NOW })).toEqual({
      sessions: 0,
      journalRows: 0
    })
    expect(rowCount(database, 'journal_rows')).toBe(2)
  })
})
