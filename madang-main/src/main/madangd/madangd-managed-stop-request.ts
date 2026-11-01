import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import {
  MADANGD_MANAGED_STOP_REQUEST_MAX_BYTES,
  MADANGD_MANAGED_STOP_REQUEST_PREFIX,
  MadangdManagedStopRequestSchema,
  type MadangdManagedStopContext,
  type MadangdManagedStopInstance,
  type MadangdManagedStopRequest
} from '../../shared/madangd-stop-request'
import { readMadangdInstanceLockRecord, type MadangdLockRecord } from './madangd-instance-lock'

/** Nonce-scoped paths prevent requests from addressing a previous instance. */
export function madangdManagedStopRequestPath(instance: MadangdManagedStopInstance): string {
  const digest = createHash('sha256').update(instance.nonce).digest('hex')
  return join(dirname(instance.lockPath), `${MADANGD_MANAGED_STOP_REQUEST_PREFIX}.${digest}`)
}

export function readMadangdManagedStopRequest(path: string): MadangdManagedStopRequest {
  if (!lstatSync(path).isFile()) {
    throw new Error('madangd_managed_stop_request_not_regular_file')
  }
  const { buffer } = readNodeFileSyncWithinLimit(path, MADANGD_MANAGED_STOP_REQUEST_MAX_BYTES)
  return MadangdManagedStopRequestSchema.parse(JSON.parse(buffer.toString('utf8')))
}

function sameMadangdManagedStopInstance(
  left: MadangdManagedStopInstance,
  right: Pick<MadangdManagedStopInstance, 'pid' | 'startedAtMs' | 'nonce'>
): boolean {
  return (
    left.pid === right.pid && left.startedAtMs === right.startedAtMs && left.nonce === right.nonce
  )
}

export function madangdInstanceLockNames(instance: MadangdManagedStopInstance): boolean {
  return readMadangdInstanceLockNaming(instance) !== null
}

export function readMadangdInstanceLockNaming(
  instance: MadangdManagedStopInstance
): MadangdLockRecord | null {
  if (!lstatSync(instance.lockPath).isFile()) {
    return null
  }
  const record = readMadangdInstanceLockRecord(instance.lockPath)
  return record !== null && sameMadangdManagedStopInstance(instance, record) ? record : null
}

export function validateMadangdManagedStopRequest(
  context: MadangdManagedStopContext,
  requestPath: string
): MadangdManagedStopRequest {
  const request = readMadangdManagedStopRequest(requestPath)
  if (
    request.version !== context.version ||
    request.runtimeId !== context.runtimeId ||
    // Windows clients and servers may use different separators for the same lock.
    resolve(request.instance.lockPath) !== resolve(context.instance.lockPath) ||
    !sameMadangdManagedStopInstance(request.instance, context.instance)
  ) {
    throw new Error('madangd_managed_stop_request_identity_mismatch')
  }
  if (!madangdInstanceLockNames(context.instance)) {
    throw new Error('madangd_managed_stop_instance_lock_changed')
  }
  return request
}
