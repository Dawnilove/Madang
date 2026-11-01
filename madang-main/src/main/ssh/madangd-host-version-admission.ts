/** Reject activation over state a newer host build may already have migrated. */
import { compareAppVersions } from '../../shared/app-version'
import type { MadangdActivationRecord } from '../managed-server/activation/madangd-activation-record'

export type MadangdHostVersionRefusal = 'host-newer'

export function refuseMadangdHostDowngrade(
  record: MadangdActivationRecord,
  candidateVersion: string,
  appVersion: string
): MadangdHostVersionRefusal | null {
  // Restarting the stopped build cannot downgrade state.
  if (record.active === null && record.previous === candidateVersion) {
    return null
  }
  // Older Stop records omit app version; refuse only proven newer hosts or they would be stranded.
  if (!record.activeAppVersion) {
    return null
  }
  return compareAppVersions(record.activeAppVersion, appVersion) > 0 ? 'host-newer' : null
}
