// Exclusive hard links arbitrate stop versus cancel; cancel cannot succeed once dispatch wins.
import { linkSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  MadangdManagedStopDecisionSchema,
  MadangdManagedStopRequestSchema,
  type MadangdManagedStopDecision,
  type MadangdManagedStopRequest
} from '../../shared/madangd-stop-request'
import { madangdStopReceiptPath, readMadangdStopReceipt } from './madangd-completed-stop-receipt'
import { hasErrorCode } from '../daemon/daemon-process-inspection'

type MadangdManagedStopDecisionValue = MadangdManagedStopDecision['decision']

export function readMadangdManagedStopDecision(
  request: MadangdManagedStopRequest
): MadangdManagedStopDecisionValue | null {
  return readMadangdStopReceipt(request, 'decision', MadangdManagedStopDecisionSchema)?.decision ?? null
}

export function claimMadangdManagedStopDecision(
  input: MadangdManagedStopRequest,
  decision: MadangdManagedStopDecisionValue
): MadangdManagedStopDecisionValue {
  const request = MadangdManagedStopRequestSchema.parse(input)
  const path = madangdStopReceiptPath(request, 'decision')
  const staged = `${path}.${process.pid}.${randomUUID()}.staged`
  const record: MadangdManagedStopDecision = {
    schemaVersion: 1,
    kind: 'madangd_managed_stop_decision',
    request,
    decision
  }
  if (!writeDurableSecureJsonFile(staged, record)) {
    rmSync(staged, { force: true })
    throw new Error('madangd_managed_stop_decision_permissions_unconfirmed')
  }
  try {
    linkSync(staged, path)
    return decision
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) {
      throw error
    }
    const standing = readMadangdManagedStopDecision(request)
    if (!standing) {
      throw new Error('madangd_managed_stop_decision_unverifiable')
    }
    return standing
  } finally {
    rmSync(staged, { force: true })
  }
}
