/** Reuse SSH update admission: keep newer, rolled-back or launch-rejected incumbents serving; fenced activation replans before committing. */
import {
  MADANGD_HOST_NEWER_DEFERRAL_CODE,
  type WslHostDeferredUpdate
} from '../../shared/wsl-host-types'
import { refuseMadangdHostDowngrade } from '../ssh/madangd-host-version-admission'
import type { ServeReadiness } from '../server/serve-readiness'
import type { MadangdActivationRecord } from '../managed-server/activation/madangd-activation-record'
import { readMadangdActivationRecord } from '../managed-server/activation/madangd-activation-record-store'
import { isWaitingMadangdUpdateDeferral } from '../managed-server/lifecycle/madangd-managed-auto-update'
import {
  madangdUpdateSkipRefusal,
  planMadangdUpdateForIntent,
  type ManagedMadangdAutoUpdatePlan,
  type MadangdUpdateIntent
} from '../managed-server/lifecycle/madangd-managed-update-decision'
import {
  madangdUpdateFailureThisLaunch,
  recordMadangdUpdateFailedThisLaunch,
  type MadangdUpdateFailure,
  type MadangdUpdateFailureHost
} from '../managed-server/lifecycle/madangd-managed-update-failure-memory'
import { MADANGD_ACTIVATION_POLICY_REFUSED_CODE } from '../ssh/madangd-installed-activation'
import type { MadangdSlotOptions } from '../ssh/madangd-recovery-slot'
import { adoptRunningMadangdVersion } from '../ssh/madangd-running-version-adoption'
import type { WslMadangdLaunch } from './wsl-madangd-deploy'

type WslMadangdReadyLaunch = Extract<WslMadangdLaunch, { outcome: 'ready' }>

export type WslMadangdUpdateAdmission =
  | {
      action: 'serve'
      version: string
      readiness: ServeReadiness
      deferredUpdate: WslHostDeferredUpdate | null
    }
  /** Another run holds the host fence; a later connect adopts or deploys. */
  | { action: 'defer'; deferredUpdate: WslHostDeferredUpdate }
  /** Deploy this app's build on this record. */
  | { action: 'deploy'; record: MadangdActivationRecord }

export async function admitWslMadangdUpdate(args: {
  slot: MadangdSlotOptions
  record: MadangdActivationRecord
  candidateVersion: string
  appVersion: string
  host: MadangdUpdateFailureHost
  intent: MadangdUpdateIntent
}): Promise<WslMadangdUpdateAdmission> {
  const { record, candidateVersion, appVersion } = args
  if (!record.active) {
    return { action: 'deploy', record }
  }
  const failure = madangdUpdateFailureThisLaunch(args.host)
  const plan = planMadangdUpdateForIntent(args.intent, {
    record,
    candidateVersion,
    appVersion,
    failedBefore: failure !== null
  })
  if (plan.action !== 'skip' || plan.reason === 'current') {
    return { action: 'deploy', record }
  }
  const adopted = await adoptRunningMadangdVersion(args.slot, record, candidateVersion)
  if (!adopted) {
    // Nothing active any more: deploy on the record the wake read; its fenced admission re-plans.
    return { action: 'deploy', record: await readMadangdActivationRecord(args.slot) }
  }
  if ('outcome' in adopted) {
    const { candidateVersion: version, code, reason, forceable } = adopted
    return {
      action: 'defer',
      deferredUpdate: { candidateVersion: version, code, reason, forceable: forceable === true }
    }
  }
  return {
    action: 'serve',
    version: adopted.version,
    readiness: adopted.readiness,
    deferredUpdate:
      adopted.version === candidateVersion
        ? null
        : skippedUpdateHint(plan, failure, record, candidateVersion, appVersion)
  }
}

/** The launch an admission ends in, or the record to deploy on. */
export async function admitWslMadangdLaunch(
  args: Parameters<typeof admitWslMadangdUpdate>[0],
  distro: string,
  readyLaunch: (serving: {
    fullVersion: string
    readiness: ServeReadiness
  }) => Promise<WslMadangdReadyLaunch>
): Promise<WslMadangdLaunch | MadangdActivationRecord> {
  const admission = await admitWslMadangdUpdate(args)
  if (admission.action === 'deploy') {
    return admission.record
  }
  if (admission.action === 'defer') {
    return { outcome: 'deferred', distro, ...admission.deferredUpdate }
  }
  const ready = await readyLaunch({
    fullVersion: admission.version,
    readiness: admission.readiness
  })
  return admission.deferredUpdate ? { ...ready, deferredUpdate: admission.deferredUpdate } : ready
}

/** Offer Update/Force for retriable host deferrals; newer hosts get no hint because Update cannot change that refusal. */
function skippedUpdateHint(
  plan: ManagedMadangdAutoUpdatePlan,
  failure: MadangdUpdateFailure | null,
  record: MadangdActivationRecord,
  candidateVersion: string,
  appVersion: string
): WslHostDeferredUpdate | null {
  if (plan.action !== 'skip') {
    return null
  }
  if (plan.reason === 'failed-before' && failure) {
    return { candidateVersion, ...failure, forceable: true }
  }
  const refusal =
    plan.reason === 'rolled-back'
      ? madangdUpdateSkipRefusal(plan, record, candidateVersion, appVersion)
      : null
  return refusal
    ? {
        candidateVersion,
        code: MADANGD_ACTIVATION_POLICY_REFUSED_CODE,
        reason: refusal,
        forceable: true
      }
    : null
}

/** Do not retry rejected/thrown incumbent updates this launch, matching SSH. Waits/policy refusals never attempted activation and record no failure. */
export function recordWslMadangdUpdateFailure(
  host: MadangdUpdateFailureHost,
  incumbentVersion: string | null,
  failure: MadangdUpdateFailure | null
): void {
  if (incumbentVersion && failure) {
    recordMadangdUpdateFailedThisLaunch(host, failure)
  }
}

export function wslMadangdDeferralFailure(deployed: {
  code: string
  reason: string
}): MadangdUpdateFailure | null {
  return isWaitingMadangdUpdateDeferral(deployed.code) ||
    deployed.code === MADANGD_ACTIVATION_POLICY_REFUSED_CODE
    ? null
    : { code: deployed.code, reason: deployed.reason }
}

/** A policy refusal over a host a newer Orca runs gets its own code: an Update cannot pass it. */
export async function wslMadangdDeferralCode(
  slot: MadangdSlotOptions,
  deployed: { code: string; fullVersion: string },
  appVersion: string
): Promise<string> {
  if (deployed.code !== MADANGD_ACTIVATION_POLICY_REFUSED_CODE) {
    return deployed.code
  }
  const record = await readMadangdActivationRecord(slot).catch(() => null)
  return record && refuseMadangdHostDowngrade(record, deployed.fullVersion, appVersion)
    ? MADANGD_HOST_NEWER_DEFERRAL_CODE
    : deployed.code
}
