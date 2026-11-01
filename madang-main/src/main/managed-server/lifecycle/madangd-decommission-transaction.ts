// Only process-exited may commit; dispatched phases nest under prepared for released readers.
import {
  serializeMadangdActivationRecord,
  withDeactivatedVersion,
  withDeactivatedVersionCommitted,
  type MadangdActivationRecord
} from '../activation/madangd-activation-record'
import { MADANGD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from '../activation/madangd-activation-transaction-schema'
import type { MadangdManagedStopRequest } from '../../../shared/madangd-stop-request'

export type MadangdDecommissionTransaction = {
  schemaVersion: typeof MADANGD_ACTIVATION_TRANSACTION_SCHEMA_VERSION
  transactionId: string
  operation: 'decommission'
  phase: 'prepared' | 'stop-dispatched' | 'process-exited'
  startedAt: string
  updatedAt: string
  activeVersion: string
  recordBefore: MadangdActivationRecord
  recordAfter: MadangdActivationRecord
  request: MadangdManagedStopRequest | null
}

/** Released desktops drop this field. */
type MadangdDecommissionDispatch = {
  phase: 'stop-dispatched' | 'process-exited'
  request: MadangdManagedStopRequest
}

type MadangdDecommissionJournal = Omit<MadangdDecommissionTransaction, 'phase' | 'request'> & {
  phase: 'prepared'
  request: null
  dispatched?: MadangdDecommissionDispatch
}

export type MadangdDecommissionRecoveryPlan =
  | { action: 'confirm-decommissioned'; version: string; record: MadangdActivationRecord | null }
  /** Completion or cancellation must settle a possibly delivered request. */
  | { action: 'resume-stop'; request: MadangdManagedStopRequest; record: MadangdActivationRecord }
  | { action: 'keep-serving'; version: string }

export function createMadangdDecommissionTransaction(options: {
  transactionId: string
  recordBefore: MadangdActivationRecord & { active: string }
  now: Date
}): MadangdDecommissionTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: MADANGD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'decommission',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    activeVersion: options.recordBefore.active,
    recordBefore: options.recordBefore,
    recordAfter: withDeactivatedVersion(options.recordBefore),
    request: null
  }
}

export function withMadangdDecommissionStopDispatched(
  transaction: MadangdDecommissionTransaction,
  request: MadangdManagedStopRequest,
  now: Date
): MadangdDecommissionTransaction {
  return { ...transaction, phase: 'stop-dispatched', updatedAt: now.toISOString(), request }
}

export function withMadangdDecommissionProcessExited(
  transaction: MadangdDecommissionTransaction,
  now: Date
): MadangdDecommissionTransaction {
  return { ...transaction, phase: 'process-exited', updatedAt: now.toISOString() }
}

/** Keep top-level prepared so released readers relaunch the recorded build instead of downgrading.
 * Their parser drops dispatched; their completed-stop path loses activeAppVersion protection. */
export function madangdDecommissionJournal(
  transaction: MadangdDecommissionTransaction
): MadangdDecommissionJournal {
  const { phase, request, ...rest } = transaction
  return phase === 'prepared' || !request
    ? { ...rest, phase: 'prepared', request: null }
    : { ...rest, phase: 'prepared', request: null, dispatched: { phase, request } }
}

export function madangdDecommissionTransactionDefect(
  transaction: MadangdDecommissionTransaction
): string | null {
  if (transaction.recordBefore.active !== transaction.activeVersion) {
    return 'decommission version does not match recordBefore'
  }
  if (
    serializeMadangdActivationRecord(transaction.recordAfter) !==
    serializeMadangdActivationRecord(withDeactivatedVersion(transaction.recordBefore))
  ) {
    return 'recordAfter is not the deactivated recordBefore'
  }
  if (transaction.request && transaction.request.version !== transaction.activeVersion) {
    return 'stop request names another version'
  }
  return null
}

export function planMadangdDecommissionRecovery(
  transaction: MadangdDecommissionTransaction,
  committed: boolean
): MadangdDecommissionRecoveryPlan {
  if (committed) {
    return { action: 'confirm-decommissioned', version: transaction.activeVersion, record: null }
  }
  if (transaction.phase === 'process-exited') {
    return {
      action: 'confirm-decommissioned',
      version: transaction.activeVersion,
      record: committedMadangdDecommissionRecord(transaction)
    }
  }
  if (transaction.phase === 'stop-dispatched' && transaction.request) {
    return {
      action: 'resume-stop',
      request: transaction.request,
      record: committedMadangdDecommissionRecord(transaction)
    }
  }
  return { action: 'keep-serving', version: transaction.activeVersion }
}

/** Preserve advisory fields alongside the journaled recordAfter. */
export function committedMadangdDecommissionRecord(
  transaction: MadangdDecommissionTransaction
): MadangdActivationRecord {
  return withDeactivatedVersionCommitted(transaction.recordBefore)
}
