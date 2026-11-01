/** Pin every journaled slot needed for recovery. An unreadable journal or unjournaled held fence hides transaction state, so GC must retain everything. */
import { madangdInstallDirNames } from '../managed-server/activation/madangd-activation-record'
import type { MadangdActivationTransaction } from '../managed-server/activation/madangd-activation-transaction'
import { readMadangdActivationTransaction } from '../managed-server/activation/madangd-activation-transaction-store'
import { madangdActivationFenceExists } from '../managed-server/activation/madangd-activation-lock'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import type { MadangdRemoteExecTarget } from '../managed-server/install/madangd-remote-runtime-control'

type MadangdGcTransactionPins = { state: 'pinned'; dirNames: string[] } | { state: 'keep-all' }

function transactionVersions(transaction: MadangdActivationTransaction): (string | null)[] {
  const records = [transaction.recordBefore, transaction.recordAfter]
  const fromRecords = records.flatMap((record) => (record ? [record.active, record.previous] : []))
  if (transaction.operation === 'activate') {
    return [...fromRecords, transaction.candidateVersion]
  }
  return transaction.operation === 'rollback'
    ? [...fromRecords, transaction.incumbentVersion, transaction.targetVersion]
    : fromRecords
}

export async function readMadangdGcTransactionPins(
  target: MadangdRemoteExecTarget & { remoteHome: string }
): Promise<MadangdGcTransactionPins> {
  try {
    const transaction = await readMadangdActivationTransaction(target)
    if (!transaction) {
      // An unjournaled fence may be a transaction starting or an interrupted release.
      return (await madangdActivationFenceExists(target))
        ? { state: 'keep-all' }
        : { state: 'pinned', dirNames: [] }
    }
    return { state: 'pinned', dirNames: madangdInstallDirNames(transactionVersions(transaction)) }
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return { state: 'keep-all' }
  }
}
