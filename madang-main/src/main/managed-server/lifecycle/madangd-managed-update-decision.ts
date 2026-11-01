import { compareAppVersions, isValidAppVersion } from '../../../shared/app-version'
import type { MadangdActivationRecord } from '../activation/madangd-activation-record'
import {
  refuseMadangdHostDowngrade,
  type MadangdHostVersionRefusal
} from '../../ssh/madangd-host-version-admission'

export type ManagedMadangdAutoUpdateSkip =
  | 'current'
  | 'no-template'
  | 'rolled-back'
  | 'failed-before'
  | 'migrating'
  | MadangdHostVersionRefusal

/** Connect honors all skips; Update retries local failures/rollbacks; Force also lifts version skips. */
export type MadangdUpdateIntent = 'connect' | 'update' | 'force'

export type ManagedMadangdAutoUpdatePlan =
  | { action: 'update' }
  | { action: 'skip'; reason: ManagedMadangdAutoUpdateSkip }

export function planManagedMadangdAutoUpdate(input: {
  record: MadangdActivationRecord
  candidateVersion: string | null
  appVersion: string
  failedBefore: boolean
}): ManagedMadangdAutoUpdatePlan {
  const { record, candidateVersion } = input
  if (!candidateVersion) {
    return { action: 'skip', reason: 'no-template' }
  }
  if (record.active === candidateVersion) {
    return { action: 'skip', reason: 'current' }
  }
  if (record.rolledBackFrom === candidateVersion) {
    return { action: 'skip', reason: 'rolled-back' }
  }
  const refusal = refuseMadangdHostDowngrade(record, candidateVersion, input.appVersion)
  if (refusal) {
    return { action: 'skip', reason: refusal }
  }
  // A stopped host has no serving fallback; retry even after a prior failed attempt.
  if (record.active === null && record.previous !== null) {
    return { action: 'update' }
  }
  return input.failedBefore ? { action: 'skip', reason: 'failed-before' } : { action: 'update' }
}

export function planMadangdUpdateForIntent(
  intent: MadangdUpdateIntent,
  input: Parameters<typeof planManagedMadangdAutoUpdate>[0]
): ManagedMadangdAutoUpdatePlan {
  if (intent === 'force') {
    return { action: 'update' }
  }
  if (intent === 'connect') {
    return planManagedMadangdAutoUpdate(input)
  }
  const { rolledBackFrom: _retried, ...record } = input.record
  return planManagedMadangdAutoUpdate({ ...input, record, failedBefore: false })
}

export function admitMadangdRecordForIntent(
  intent: MadangdUpdateIntent,
  appVersion: string
): (record: MadangdActivationRecord, candidateVersion: string) => string | null {
  return (record, candidateVersion) =>
    madangdUpdateSkipRefusal(
      planMadangdUpdateForIntent(intent, {
        record,
        candidateVersion,
        appVersion,
        failedBefore: false
      }),
      record,
      candidateVersion,
      appVersion
    )
}

export function madangdUpdateSkipRefusal(
  plan: ManagedMadangdAutoUpdatePlan,
  record: MadangdActivationRecord,
  candidateVersion: string,
  appVersion: string
): string | null {
  if (plan.action !== 'skip' || plan.reason === 'current') {
    return null
  }
  return plan.reason === 'rolled-back'
    ? `This host's server rolled back from ${candidateVersion}, so a connect does not activate ` +
        'it again; choose Update or Force to retry it.'
    : `Madang ${record.activeAppVersion} last ran this host's server, newer than this ` +
        `Madang (${appVersion}). Update Madang to start it.`
}

/** Content hashes cannot order updates: compare Orca versions, or for legacy hosts offer only this desktop's previously deferred build. */
export function availableManagedMadangdUpdate(input: {
  record: MadangdActivationRecord
  candidateVersion: string | null
  appVersion: string
  /** The build this desktop's last Update or connect deferred on this host. */
  deferredCandidateVersion: string | null
}): string | null {
  const { record, candidateVersion, appVersion } = input
  const hostAppVersion = record.activeAppVersion
  if (!candidateVersion || record.active === null || !isValidAppVersion(appVersion)) {
    return null
  }
  const ordered = hostAppVersion
    ? isValidAppVersion(hostAppVersion) && compareAppVersions(appVersion, hostAppVersion) >= 0
    : input.deferredCandidateVersion === candidateVersion
  if (!ordered) {
    return null
  }
  // Connect rules: a build the user rolled back from is not advertised again.
  const plan = planManagedMadangdAutoUpdate({
    record,
    candidateVersion,
    appVersion,
    failedBefore: false
  })
  return plan.action === 'update' ? candidateVersion : null
}
