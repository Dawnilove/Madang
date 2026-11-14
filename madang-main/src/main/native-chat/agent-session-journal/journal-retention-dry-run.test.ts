import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import {
  createAgentSessionRecordTablesSql,
  createJournalTablesSql
} from './journal-database-schema'
import { planRetentionCleanup } from './journal-retention-dry-run'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 13)
const OLD = NOW - 200 * DAY
const RECENT = NOW - 5 * DAY

const releasedLease = {
  claimStatus: 'released',
  handoffStage: null,
  ownerProcess: null,
  reservedSpawnToken: null,
  provenHandleLinkId: null,
  deathEvidence: null,
  unreconciled: true
}
const exitedLease = {
  ...releasedLease,
  deathEvidence: { kind: 'exit-observed', detail: 'x', observedAt: OLD }
}
const liveLease = {
  ...releasedLease,
  claimStatus: 'live',
  ownerProcess: { hostId: 'h', pid: 1, processStartTimeMs: null, spawnToken: 't' }
}

describe('planRetentionCleanup', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(createJournalTablesSql())
    db.exec(createAgentSessionRecordTablesSql())
    db.exec(
      `CREATE TABLE queued_messages (session_id TEXT NOT NULL, message_id TEXT NOT NULL, state TEXT NOT NULL)`
    )
  })
  afterEach(() => db.close())

  function addSession(
    id: string,
    record: { lease?: object; createdAt?: number; sleptAt?: number },
    rows: { ts: number; count: number } = { ts: OLD, count: 2 }
  ): void {
    db.prepare('INSERT INTO agent_session_records (session_id, record_json) VALUES (?, ?)').run(
      id,
      JSON.stringify({ lease: exitedLease, createdAt: OLD, updatedAt: NOW, ...record })
    )
    for (let seq = 1; seq <= rows.count; seq += 1) {
      db.prepare('INSERT INTO journal_rows VALUES (?, ?, ?, ?, ?)').run(id, 'e', seq, rows.ts, '{}')
    }
  }
  const plan = (retentionDays = 90) => planRetentionCleanup(db, { retentionDays, now: NOW })

  it('counts old exited sessions and their journal rows', () => {
    addSession('a', {})
    addSession('b', { lease: releasedLease }, { ts: OLD, count: 3 })
    expect(plan()).toMatchObject({ sessions: 2, journalRows: 5 })
  })

  it('keeps recent sessions, using the later of createdAt and the newest journal row, never updatedAt', () => {
    addSession('new-record', { createdAt: RECENT })
    addSession('new-rows', {}, { ts: RECENT, count: 1 })
    expect(plan()).toMatchObject({ sessions: 0, kept: { recent: 2 } })
  })

  it('keeps open-tab, running, queued and sleeping sessions', () => {
    addSession('tab', {})
    db.prepare('INSERT INTO agent_session_tabs VALUES (?, ?, 0)').run('t1', 'tab')
    addSession('live', { lease: liveLease })
    addSession('queued', {})
    db.prepare('INSERT INTO queued_messages VALUES (?, ?, ?)').run('queued', 'm', 'queued')
    addSession('sleep', { sleptAt: OLD })
    expect(plan()).toMatchObject({
      sessions: 0,
      kept: { openTab: 1, running: 1, queuedMessages: 1, sleeping: 1 }
    })
  })

  it('keeps unreadable records and does not modify the database', () => {
    db.prepare('INSERT INTO agent_session_records VALUES (?, ?)').run('bad', '{not json')
    addSession('a', {})
    const before = db.prepare('SELECT COUNT(*) AS n FROM journal_rows').get()?.n
    expect(plan()).toMatchObject({ sessions: 1, kept: { unreadable: 1 } })
    expect(db.prepare('SELECT COUNT(*) AS n FROM journal_rows').get()?.n).toBe(before)
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_session_records').get()?.n).toBe(2)
  })

  it('returns zeros when tables are missing', () => {
    const empty = new Database(':memory:')
    expect(planRetentionCleanup(empty, { retentionDays: 30, now: NOW }).sessions).toBe(0)
    empty.close()
  })
})
