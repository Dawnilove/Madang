import type { MadangdManagedDeferral } from '../../../shared/madangd-managed-runtime'
import { compareAppVersions } from '../../../shared/app-version'

type RecordedDeferral = MadangdManagedDeferral & { deferredAt: string }

const deferrals = new Map<string, RecordedDeferral>()

export function recordManagedMadangdUpdateDeferral(
  environmentId: string,
  deferral: MadangdManagedDeferral,
  now = new Date()
): void {
  deferrals.set(environmentId, { ...deferral, deferredAt: now.toISOString() })
}

export function clearManagedMadangdUpdateDeferral(environmentId: string): void {
  deferrals.delete(environmentId)
}

function readManagedMadangdUpdateDeferral(environmentId: string): RecordedDeferral | null {
  return deferrals.get(environmentId) ?? null
}

/** Forget deferrals resolved by another desktop activating the candidate or a newer release. */
export function currentManagedMadangdUpdateDeferral(
  environmentId: string,
  activeVersion: string | null
): RecordedDeferral | null {
  const deferral = readManagedMadangdUpdateDeferral(environmentId)
  if (
    deferral &&
    activeVersion &&
    (activeVersion === deferral.candidateVersion ||
      compareAppVersions(activeVersion, deferral.candidateVersion) > 0)
  ) {
    clearManagedMadangdUpdateDeferral(environmentId)
    return null
  }
  return deferral
}
