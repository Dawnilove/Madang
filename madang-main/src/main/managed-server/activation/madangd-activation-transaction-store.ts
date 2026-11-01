import {
  madangdActivationTransactionPath,
  parseMadangdActivationTransaction,
  serializeMadangdActivationTransaction,
  type MadangdActivationTransaction
} from './madangd-activation-transaction'
import {
  readBoundedMadangdRemoteRecord,
  writeAtomicMadangdRemoteRecord
} from '../install/madangd-remote-record-file'
import type { MadangdRemoteExecTarget } from '../install/madangd-remote-runtime-control'
import { currentMadangdFence } from './madangd-activation-fence-scope'

const MADANGD_ACTIVATION_TRANSACTION_MAX_BYTES = 64 * 1024

type MadangdActivationTransactionStoreOptions = MadangdRemoteExecTarget & { remoteHome: string }

/** Only verified absence returns null; unreadable journals retain the fence. */
export async function readMadangdActivationTransaction(
  options: MadangdActivationTransactionStoreOptions
): Promise<MadangdActivationTransaction | null> {
  const read = await readBoundedMadangdRemoteRecord(
    options,
    madangdActivationTransactionPath(options.host, options.remoteHome),
    MADANGD_ACTIVATION_TRANSACTION_MAX_BYTES
  )
  const parsed = parseMadangdActivationTransaction(read.state === 'present' ? read.raw : null)
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's madangd activation transaction: ${parsed.reason}`)
  }
  return parsed.state === 'ok' ? parsed.transaction : null
}

/** Stamp each write with its fence generation so release cannot delete another holder's journal. */
export function writeMadangdActivationTransaction(
  options: MadangdActivationTransactionStoreOptions,
  transaction: MadangdActivationTransaction
): Promise<void> {
  const fenceToken = currentMadangdFence()?.token
  return writeAtomicMadangdRemoteRecord(
    options,
    madangdActivationTransactionPath(options.host, options.remoteHome),
    serializeMadangdActivationTransaction(fenceToken ? { ...transaction, fenceToken } : transaction)
  )
}
