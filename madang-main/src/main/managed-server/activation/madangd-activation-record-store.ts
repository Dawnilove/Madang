// Unreadable activation records must fail closed; treating them as absent could overwrite a live install and its rollback target.
import type { MadangdHostTransport } from '../../ssh/madangd-host-transport'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import {
  MADANGD_ACTIVATION_FILENAME,
  emptyMadangdActivationRecord,
  parseMadangdActivationRecord,
  serializeMadangdActivationRecord,
  type MadangdActivationReadResult,
  type MadangdActivationRecord
} from './madangd-activation-record'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  readBoundedMadangdRemoteRecord,
  writeAtomicMadangdRemoteRecord
} from '../install/madangd-remote-record-file'

const MADANGD_ACTIVATION_RECORD_MAX_BYTES = 64 * 1024

type ActivationRecordTarget = {
  conn: MadangdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  signal?: AbortSignal
}

function madangdActivationPath(host: RemoteHostPlatform, remoteHome: string): string {
  return joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR, MADANGD_ACTIVATION_FILENAME)
}

async function readActivationRecordState(
  options: ActivationRecordTarget
): Promise<MadangdActivationReadResult> {
  const read = await readBoundedMadangdRemoteRecord(
    options,
    madangdActivationPath(options.host, options.remoteHome),
    MADANGD_ACTIVATION_RECORD_MAX_BYTES
  )
  return read.state === 'absent' ? read : parseMadangdActivationRecord(read.raw)
}

export async function readMadangdActivationRecord(
  options: ActivationRecordTarget
): Promise<MadangdActivationRecord> {
  const parsed = await readActivationRecordState(options)
  if (parsed.state === 'ok') {
    return parsed.record
  }
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's madangd activation record: ${parsed.reason}`)
  }
  return emptyMadangdActivationRecord()
}

/** Refuse replacement of unreadable records, including schemas written by newer clients. */
export async function writeMadangdActivationRecord(
  options: ActivationRecordTarget,
  record: MadangdActivationRecord
): Promise<void> {
  const existing = await readActivationRecordState(options)
  if (existing.state === 'unreadable') {
    throw new Error(`Refusing to overwrite this host's madangd activation record: ${existing.reason}`)
  }
  await writeAtomicMadangdRemoteRecord(
    options,
    madangdActivationPath(options.host, options.remoteHome),
    serializeMadangdActivationRecord(record)
  )
}
