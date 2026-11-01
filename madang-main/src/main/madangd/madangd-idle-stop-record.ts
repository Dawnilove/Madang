// Consume clean idle-stop evidence once; discard failed stops so later crashes cannot inherit it.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  MADANGD_IDLE_STOP_RECORD_FILENAME,
  MadangdIdleStopRecordSchema,
  type MadangdIdleStopRecord
} from '../../shared/madangd-idle-exit'
import type { MadangdIdleExitEvidence } from './madangd-idle-exit-monitor'
import { hasErrorCode } from '../daemon/daemon-process-inspection'

const RECORD_MAX_BYTES = 16 * 1024

export function madangdIdleStopRecordPath(userDataPath: string): string {
  return join(userDataPath, MADANGD_IDLE_STOP_RECORD_FILENAME)
}

export function writeMadangdIdleStopRecord(
  userDataPath: string,
  evidence: MadangdIdleExitEvidence,
  version: string
): void {
  const record: MadangdIdleStopRecord = {
    schemaVersion: 1,
    kind: 'madangd_idle_stop',
    pid: process.pid,
    version,
    quietSince: new Date(evidence.quietSince).toISOString(),
    stoppedAt: new Date(evidence.stoppedAt).toISOString(),
    idleTimeoutMs: evidence.timeoutMs
  }
  if (!writeDurableSecureJsonFile(madangdIdleStopRecordPath(userDataPath), record)) {
    throw new Error('madangd_idle_stop_record_permissions_unconfirmed')
  }
}

export function consumeMadangdIdleStopRecord(userDataPath: string): MadangdIdleStopRecord | null {
  const path = madangdIdleStopRecordPath(userDataPath)
  let record: MadangdIdleStopRecord | null = null
  try {
    const raw = readNodeFileSyncWithinLimit(path, RECORD_MAX_BYTES).buffer.toString('utf8')
    record = MadangdIdleStopRecordSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    console.error('[madangd] ignoring an unreadable idle-stop record:', error)
  }
  rmSync(path, { force: true })
  return record
}

export function discardMadangdIdleStopRecord(userDataPath: string): void {
  rmSync(madangdIdleStopRecordPath(userDataPath), { force: true })
}
