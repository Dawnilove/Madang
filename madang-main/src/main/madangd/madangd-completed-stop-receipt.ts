import { lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import { hasErrorCode } from '../daemon/daemon-process-inspection'
import {
  MADANGD_STOP_RECEIPTS_DIRNAME,
  MadangdCompletedStopReceiptSchema,
  MadangdManagedStopRequestSchema,
  MadangdDaemonRetirementRecordSchema,
  madangdManagedStopRequestKey,
  type MadangdCompletedStopReceipt,
  type MadangdDaemonRetirementRecord,
  type MadangdManagedStopRequest
} from '../../shared/madangd-stop-request'

const RECEIPT_MAX_BYTES = 64 * 1024

type ReceiptKind = 'completed' | 'retirement' | 'decision'

export function madangdStopReceiptPath(request: MadangdManagedStopRequest, kind: ReceiptKind): string {
  const { transactionId, instance } = MadangdManagedStopRequestSchema.parse(request)
  const suffix = kind === 'completed' ? '' : `.${kind}`
  return join(
    dirname(instance.lockPath),
    MADANGD_STOP_RECEIPTS_DIRNAME,
    `${transactionId}${suffix}.json`
  )
}

/** Absent returns null; mismatched request receipts throw. */
export function readMadangdStopReceipt<T extends { request: MadangdManagedStopRequest }>(
  request: MadangdManagedStopRequest,
  kind: ReceiptKind,
  schema: z.ZodType<T>
): T | null {
  const path = madangdStopReceiptPath(request, kind)
  try {
    if (!lstatSync(path).isFile()) {
      throw new Error('madangd_stop_receipt_unverifiable')
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
  const receipt = schema.parse(
    JSON.parse(readNodeFileSyncWithinLimit(path, RECEIPT_MAX_BYTES).buffer.toString('utf8'))
  )
  if (madangdManagedStopRequestKey(receipt.request) !== madangdManagedStopRequestKey(request)) {
    throw new Error('madangd_stop_receipt_mismatch')
  }
  return receipt
}

function writeReceipt(request: MadangdManagedStopRequest, kind: ReceiptKind, receipt: unknown): void {
  if (!writeDurableSecureJsonFile(madangdStopReceiptPath(request, kind), receipt)) {
    throw new Error('madangd_stop_receipt_permissions_unconfirmed')
  }
}

export function readMadangdCompletedStopReceipt(
  request: MadangdManagedStopRequest
): MadangdCompletedStopReceipt | null {
  return readMadangdStopReceipt(request, 'completed', MadangdCompletedStopReceiptSchema)
}

/** Persist only after proven exit and fsync even existing receipts.
 * Missing retirement records remain unverifiable. */
export function persistMadangdCompletedStopReceipt(
  request: MadangdManagedStopRequest,
  exitedAt: Date
): MadangdCompletedStopReceipt {
  const parsed = MadangdManagedStopRequestSchema.parse(request)
  const retirement = parsed.retireIdleDaemon
    ? (readMadangdDaemonRetirementRecord(parsed)?.retirement ?? 'unverifiable')
    : undefined
  const receipt = readMadangdCompletedStopReceipt(parsed) ?? {
    schemaVersion: 1 as const,
    kind: 'madangd_managed_stop_completed' as const,
    request: parsed,
    exitedAt: exitedAt.toISOString(),
    ...(retirement ? { retirement } : {})
  }
  writeReceipt(parsed, 'completed', receipt)
  return receipt
}

export function readMadangdDaemonRetirementRecord(
  request: MadangdManagedStopRequest
): MadangdDaemonRetirementRecord | null {
  return readMadangdStopReceipt(request, 'retirement', MadangdDaemonRetirementRecordSchema)
}

export function persistMadangdDaemonRetirementRecord(
  request: MadangdManagedStopRequest,
  outcome: Pick<MadangdDaemonRetirementRecord, 'retirement' | 'liveSessions' | 'reason'>
): void {
  writeReceipt(request, 'retirement', {
    schemaVersion: 1,
    kind: 'madangd_managed_stop_retirement',
    request: MadangdManagedStopRequestSchema.parse(request),
    // Name fields explicitly; extra in-process fields would fail the strict schema.
    retirement: outcome.retirement,
    liveSessions: outcome.liveSessions,
    reason: outcome.reason
  })
}
