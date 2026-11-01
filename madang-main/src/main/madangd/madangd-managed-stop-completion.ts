// Request shutdown without signaling; only kernel identity, owner change or PID absence proves exit.
import { setTimeout as delay } from 'node:timers/promises'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  MadangdManagedStopRequestSchema,
  madangdManagedStopRequestKey,
  type MadangdManagedStopInstance,
  type MadangdManagedStopRequest,
  type MadangdManagedStopVerdict
} from '../../shared/madangd-stop-request'
import {
  compareMadangdProcessIdentity,
  recordedMadangdProcessIncarnation,
  type MadangdProcessIdentityReaders,
  type MadangdRecordedIdentity
} from './madangd-process-start-time'
import { hasErrorCode, inspectProcessSignal } from '../daemon/daemon-process-inspection'
import { persistMadangdCompletedStopReceipt } from './madangd-completed-stop-receipt'
import { readMadangdManagedStopDecision } from './madangd-managed-stop-decision'
import { withdrawMadangdManagedStopRequest } from './madangd-managed-stop-cancellation'
import {
  madangdInstanceLockNames,
  madangdManagedStopRequestPath,
  readMadangdInstanceLockNaming,
  readMadangdManagedStopRequest
} from './madangd-managed-stop-request'
import {
  MADANGD_STOP_COMPLETION_POLL_ATTEMPTS,
  MADANGD_STOP_COMPLETION_POLL_MS
} from './madangd-stop-deadlines'

type MadangdProcessProbe = (pid: number) => 'alive' | 'missing' | 'unverifiable'

export type MadangdManagedStopCompletionOptions = MadangdProcessIdentityReaders & {
  probeProcess?: MadangdProcessProbe
  sleep?: () => Promise<void>
  attempts?: number
  now?: () => Date
}

function defaultProbe(pid: number): ReturnType<MadangdProcessProbe> {
  const signal = inspectProcessSignal(pid)
  // EPERM proves some process holds the PID; it cannot prove ours exited.
  return signal === 'occupied' ? 'alive' : signal === 'missing' ? 'missing' : 'unverifiable'
}

function observeInstance(
  instance: MadangdManagedStopInstance,
  recorded: MadangdRecordedIdentity,
  options: MadangdManagedStopCompletionOptions
): MadangdManagedStopVerdict {
  const probe = (options.probeProcess ?? defaultProbe)(instance.pid)
  if (probe !== 'alive') {
    return probe === 'missing' ? 'exited' : 'unverifiable'
  }
  // Wall-clock drift alone cannot prove PID reuse.
  const identity = compareMadangdProcessIdentity(instance.pid, recorded, options)
  return identity === 'differs' ? 'exited' : identity === 'unproven' ? 'unverifiable' : 'live'
}

/** Recover incarnation data from the lock for older clients that omit it. */
function recordedIdentity(instance: MadangdManagedStopInstance): MadangdRecordedIdentity {
  if (recordedMadangdProcessIncarnation(instance)) {
    return instance
  }
  let record: MadangdRecordedIdentity | null = null
  try {
    record = readMadangdInstanceLockNaming(instance)
  } catch {
    return instance
  }
  if (!record) {
    return instance
  }
  return { ...instance, ...recordedMadangdProcessIncarnation(record), identity: record.identity }
}

export async function completeMadangdManagedStop(
  input: MadangdManagedStopRequest,
  options: MadangdManagedStopCompletionOptions = {}
): Promise<MadangdManagedStopVerdict> {
  const request = MadangdManagedStopRequestSchema.parse(input)
  const attempts = options.attempts ?? MADANGD_STOP_COMPLETION_POLL_ATTEMPTS
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 240) {
    throw new Error('madangd_managed_stop_invalid_attempts')
  }
  const completed = (): 'exited' => {
    persistMadangdCompletedStopReceipt(request, (options.now ?? (() => new Date()))())
    return 'exited'
  }
  const recorded = recordedIdentity(request.instance)
  let verdict = observeInstance(request.instance, recorded, options)
  if (verdict !== 'live') {
    return verdict === 'exited' ? completed() : verdict
  }
  if (!lockStillNamesInstance(request.instance)) {
    // A live process that relinquished its lock is no longer ours to address.
    return 'unverifiable'
  }
  if (readMadangdManagedStopDecision(request) === 'canceled') {
    return 'live'
  }
  const requestPath = madangdManagedStopRequestPath(request.instance)
  if (!existingRequestMatches(requestPath, request)) {
    return 'unverifiable'
  }
  if (!writeDurableSecureJsonFile(requestPath, request)) {
    throw new Error('madangd_managed_stop_request_permissions_unconfirmed')
  }
  // A cancel between the first check and write had no request file to remove.
  if (readMadangdManagedStopDecision(request) === 'canceled') {
    withdrawMadangdManagedStopRequest(request)
    return 'live'
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    await (options.sleep ?? (() => delay(MADANGD_STOP_COMPLETION_POLL_MS)))()
    verdict = observeInstance(request.instance, recorded, options)
    if (verdict !== 'live') {
      return verdict === 'exited' ? completed() : verdict
    }
  }
  return 'live'
}

function lockStillNamesInstance(instance: MadangdManagedStopInstance): boolean {
  try {
    return madangdInstanceLockNames(instance)
  } catch {
    return false
  }
}

function existingRequestMatches(path: string, request: MadangdManagedStopRequest): boolean {
  try {
    return (
      madangdManagedStopRequestKey(readMadangdManagedStopRequest(path)) ===
      madangdManagedStopRequestKey(request)
    )
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
  }
}
