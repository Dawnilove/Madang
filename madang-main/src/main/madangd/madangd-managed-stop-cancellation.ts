import { rmSync } from 'node:fs'
import type {
  MadangdManagedStopCancellation,
  MadangdManagedStopRequest
} from '../../shared/madangd-stop-request'
import { claimMadangdManagedStopDecision } from './madangd-managed-stop-decision'
import {
  madangdManagedStopRequestPath,
  readMadangdManagedStopRequest
} from './madangd-managed-stop-request'

/** Dispatched stops cannot be canceled; their completion verdict remains authoritative. */
export function cancelMadangdManagedStop(
  request: MadangdManagedStopRequest
): MadangdManagedStopCancellation['outcome'] {
  const outcome = claimMadangdManagedStopDecision(request, 'canceled')
  if (outcome === 'canceled') {
    withdrawMadangdManagedStopRequest(request)
  }
  return outcome
}

export function withdrawMadangdManagedStopRequest(request: MadangdManagedStopRequest): void {
  const path = madangdManagedStopRequestPath(request.instance)
  try {
    if (readMadangdManagedStopRequest(path).transactionId === request.transactionId) {
      rmSync(path, { force: true })
    }
  } catch {
    // The persisted decision fences this transaction even if its request is gone.
  }
}
