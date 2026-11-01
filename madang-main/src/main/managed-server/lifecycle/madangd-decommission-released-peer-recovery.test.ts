// Frozen released-client logic verifies that older desktops can safely recover newer stop journals.
import { describe, expect, it } from 'vitest'
import {
  coreMadangdActivationRecord,
  serializeMadangdActivationRecord,
  type MadangdActivationRecord
} from '../activation/madangd-activation-record'
import {
  parseMadangdActivationTransaction,
  serializeMadangdActivationTransaction
} from '../activation/madangd-activation-transaction'
import {
  createMadangdDecommissionTransaction,
  withMadangdDecommissionProcessExited,
  withMadangdDecommissionStopDispatched,
  type MadangdDecommissionTransaction
} from './madangd-decommission-transaction'
import { FakeMadangdHost, NEW, OLD } from '../activation/madangd-activation-host-test-harness'
import { compareAppVersions } from '../../../shared/app-version'
import type { MadangdManagedStopRequest } from '../../../shared/madangd-stop-request'

const T = new Date('2026-02-02T00:00:00.000Z')
const ID = '7f1c2a7e-6c1b-4a8e-9f0e-0a1b2c3d4e5f'
const NEWER_APP = '1.6.0'
const RELEASED_APP = '1.5.0'
const before: MadangdActivationRecord & { active: string } = {
  ...FakeMadangdHost.newRecord(),
  active: NEW,
  activeAppVersion: NEWER_APP
}
const request: MadangdManagedStopRequest = {
  schemaVersion: 1,
  transactionId: ID,
  version: NEW,
  runtimeId: 'runtime-1',
  instance: { pid: 42, startedAtMs: 5, nonce: 'nonce', lockPath: '/home/u/.madang/madangd.lock' },
  retireIdleDaemon: true
}
const prepared = createMadangdDecommissionTransaction({
  transactionId: ID,
  recordBefore: before,
  now: T
})
const dispatched = withMadangdDecommissionStopDispatched(prepared, request, T)
const exited = withMadangdDecommissionProcessExited(dispatched, T)

type ReleasedJournal = {
  phase: string
  request: unknown
  activeVersion: string
  recordBefore: MadangdActivationRecord
  recordAfter: MadangdActivationRecord
}

const sameCore = (a: MadangdActivationRecord, b: MadangdActivationRecord): boolean =>
  serializeMadangdActivationRecord(coreMadangdActivationRecord(a)) ===
  serializeMadangdActivationRecord(coreMadangdActivationRecord(b))

/** Frozen released parser: unknown fields are dropped. */
function releasedParse(raw: string): ReleasedJournal {
  const journal: ReleasedJournal = JSON.parse(raw)
  if ((journal.phase === 'prepared') !== (journal.request === null)) {
    throw new Error('Stop request is inconsistent with phase')
  }
  const b = journal.recordBefore
  const deactivated = {
    schemaVersion: 1,
    active: null,
    previous: b.active,
    activatedAt: null,
    snapshot: null
  }
  if (JSON.stringify(journal.recordAfter) !== JSON.stringify(deactivated)) {
    throw new Error('recordAfter is not the deactivated recordBefore')
  }
  return journal
}

/** Frozen released recovery record. */
function releasedRecover(
  journal: ReleasedJournal,
  current: MadangdActivationRecord
): MadangdActivationRecord {
  if (sameCore(current, journal.recordAfter)) {
    return current
  }
  if (!sameCore(current, journal.recordBefore)) {
    throw new Error('record changed')
  }
  return journal.phase === 'prepared' ? current : journal.recordAfter
}

/** Frozen released auto-update planner. */
function releasedAutoUpdate(record: MadangdActivationRecord, candidate: string): 'update' | 'skip' {
  if (record.active === candidate || record.rolledBackFrom === candidate) {
    return 'skip'
  }
  return record.activeAppVersion && compareAppVersions(record.activeAppVersion, RELEASED_APP) > 0
    ? 'skip'
    : 'update'
}

function releasedPeerAfterRecovery(raw: string): 'update' | 'skip' {
  return releasedAutoUpdate(releasedRecover(releasedParse(raw), before), OLD)
}

describe('a released desktop recovering a newer desktop’s interrupted stop', () => {
  it.each([
    ['prepared', prepared],
    ['stop-dispatched', dispatched],
    ['process-exited', exited]
  ])('never downgrades the host from %s', (_phase, transaction: MadangdDecommissionTransaction) => {
    expect(releasedPeerAfterRecovery(serializeMadangdActivationTransaction(transaction))).toBe('skip')
  })

  it('would downgrade it if the journal named the dispatched phase at the top level', () => {
    expect(releasedPeerAfterRecovery(JSON.stringify(exited))).toBe('update')
  })

  it('still reads the real phase and request on a current desktop', () => {
    for (const transaction of [prepared, dispatched, exited]) {
      const raw = serializeMadangdActivationTransaction({ ...transaction, fenceToken: 'token-1' })
      expect(JSON.parse(raw)).toMatchObject({
        phase: 'prepared',
        request: null,
        fenceToken: 'token-1'
      })
      expect(parseMadangdActivationTransaction(raw)).toEqual({ state: 'ok', transaction })
    }
  })

  it.each([
    [
      'filed twice',
      {
        ...JSON.parse(serializeMadangdActivationTransaction(exited)),
        phase: 'process-exited',
        request
      }
    ],
    [
      'for another transaction',
      {
        ...JSON.parse(serializeMadangdActivationTransaction(exited)),
        dispatched: {
          phase: 'process-exited',
          request: { ...request, transactionId: '5a7e1f0c-3b2d-4e6f-9a8b-7c6d5e4f3a2b' }
        }
      }
    ]
  ])('reads a dispatched stop %s as unreadable', (_name, journal) => {
    expect(parseMadangdActivationTransaction(JSON.stringify(journal))).toMatchObject({
      state: 'unreadable'
    })
  })
})
