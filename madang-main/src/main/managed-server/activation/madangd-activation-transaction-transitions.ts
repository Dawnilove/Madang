import type { MadangdActivationRecord } from './madangd-activation-record'
import { MADANGD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from './madangd-activation-transaction-schema'
import type {
  MadangdActivateTransaction,
  MadangdRollbackTransaction
} from './madangd-activation-transaction'

export function createMadangdActivationTransaction(options: {
  transactionId: string
  candidateVersion: string
  appVersion?: string
  recordBefore: MadangdActivationRecord
  snapshotDirName: string
  now: Date
}): MadangdActivateTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: MADANGD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'activate',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    candidateVersion: options.candidateVersion,
    candidateAppVersion: options.appVersion ?? null,
    recordBefore: options.recordBefore,
    recordAfter: null,
    snapshot: { dirName: options.snapshotDirName, state: 'pending' }
  }
}

export function withMadangdActivationIncumbentStopped(
  transaction: MadangdActivateTransaction,
  now: Date
): MadangdActivateTransaction {
  return {
    ...transaction,
    phase: 'incumbent-stopped',
    updatedAt: now.toISOString()
  }
}

export function withMadangdActivationSnapshot(
  transaction: MadangdActivateTransaction,
  state: 'captured' | 'empty',
  now: Date
): MadangdActivateTransaction {
  return {
    ...transaction,
    phase: 'snapshot-captured',
    updatedAt: now.toISOString(),
    snapshot: { dirName: transaction.snapshot.dirName, state }
  }
}

export function withMadangdActivationCandidateReady(
  transaction: MadangdActivateTransaction,
  recordAfter: MadangdActivationRecord,
  now: Date
): MadangdActivateTransaction {
  return {
    ...transaction,
    phase: 'candidate-ready',
    updatedAt: now.toISOString(),
    recordAfter
  }
}

export function createMadangdRollbackTransaction(options: {
  transactionId: string
  incumbentVersion: string
  targetVersion: string
  recordBefore: MadangdActivationRecord
  recordAfter: MadangdActivationRecord
  rescueDirName: string
  now: Date
}): MadangdRollbackTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: MADANGD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'rollback',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    incumbentVersion: options.incumbentVersion,
    targetVersion: options.targetVersion,
    recordBefore: options.recordBefore,
    recordAfter: options.recordAfter,
    rescue: { dirName: options.rescueDirName, state: 'pending' }
  }
}

export function withMadangdRollbackPhase(
  transaction: MadangdRollbackTransaction,
  phase: 'incumbent-stopped' | 'rollback-state-restored' | 'target-ready',
  now: Date
): MadangdRollbackTransaction {
  return { ...transaction, phase, updatedAt: now.toISOString() }
}

export function withMadangdRollbackRescue(
  transaction: MadangdRollbackTransaction,
  state: 'captured' | 'empty',
  now: Date
): MadangdRollbackTransaction {
  return {
    ...transaction,
    phase: 'rescue-captured',
    updatedAt: now.toISOString(),
    rescue: { dirName: transaction.rescue.dirName, state }
  }
}
