import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { nativeChatScratchFolderFor } from '../native-chat-scratch-folder'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import {
  resetRetentionScheduleForTests,
  RETENTION_INTERVAL_MS,
  runRetentionCleanup,
  scheduleRetentionCleanup
} from './journal-retention-cleanup'

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

  it('removes the scratch folder of a deleted chat and keeps the others', async () => {
    const { database, store } = await setup([
      session('session-old'),
      session('session-recent', { createdAt: RECENT })
    ])
    const folders = ['session-old', 'session-recent'].map((id) =>
      nativeChatScratchFolderFor(directory, id)
    )
    for (const folder of folders) {
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'note.txt'), 'x')
    }
    await runRetentionCleanup({ store, database, retentionDays: 90, now: NOW })
    expect(existsSync(folders[0]!)).toBe(false)
    expect(existsSync(folders[1]!)).toBe(true)
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

describe('scheduleRetentionCleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('MADANG_EDITION', 'company')
    resetRetentionScheduleForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('runs after startup, then daily, and stops deleting when the setting is turned off', async () => {
    vi.setSystemTime(NOW)
    const { database, store } = await setup([session('session-a')])
    let days: number | null = 90
    const logger = { warn: vi.fn(), error: vi.fn() }
    scheduleRetentionCleanup({ store, database, readDays: () => days, logger })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.getRecord('session-a')).toBeNull()
    // The folder removal uses real file I/O, which fake timers do not advance.
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledTimes(1))

    // A chat that turns old later is caught by the next daily run, unless the setting is off.
    database.transaction((db) => {
      db.prepare('INSERT INTO journal_rows VALUES (?, ?, ?, ?, ?)').run('late', 'e', 1, OLD, '{}')
    })
    days = null
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    days = 90
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS)
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledTimes(2))
  })

  it('does nothing outside the company edition', async () => {
    vi.stubGlobal('MADANG_EDITION', 'standard')
    const { database, store } = await setup([session('session-a')])
    const logger = { warn: vi.fn(), error: vi.fn() }
    scheduleRetentionCleanup({ store, database, readDays: () => 90, logger })
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS)
    expect(store.getRecord('session-a')).not.toBeNull()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
