/** Pair with an already-running foreign build before considering update; an unpaired first deploy cannot census its terminals. */
import type { ServeReadiness } from '../server/serve-readiness'
import type { MadangdManagedDeferral } from '../../shared/madangd-managed-runtime'
import { madangdActivationFenceRefusal } from '../managed-server/activation/madangd-activation-fence-hold'
import { MadangdActiveReadinessError, probeActiveMadangdReadiness } from './madangd-active-readiness'
import type { MadangdActivationRecord } from '../managed-server/activation/madangd-activation-record'
import { readMadangdActivationRecord } from '../managed-server/activation/madangd-activation-record-store'
import { wakeStoppedManagedMadangd } from '../managed-server/lifecycle/madangd-managed-wake'
import { resolveMadangdSlotIdentity, type MadangdSlotOptions } from './madangd-recovery-slot'

export type MadangdRunningAdoption = {
  version: string
  readiness: ServeReadiness
  /** Reads the adopted slot's readiness again, e.g. after it rebinds its port. */
  reprobe: () => Promise<ServeReadiness>
}

/** No foreign activation returns null for normal deploy. A held peer fence defers: deploying without pairing would only fail census (#28833). */
export async function adoptRunningMadangdVersion(
  slot: MadangdSlotOptions,
  record: MadangdActivationRecord,
  localVersion: string,
  retryClearedFence = true
): Promise<MadangdRunningAdoption | MadangdManagedDeferral | null> {
  if (!record.active || record.active === localVersion) {
    return null
  }
  // Wake only on proven server exit; idle stops leave daemon terminals alive.
  const wake = await wakeStoppedManagedMadangd(slot)
  switch (wake.outcome) {
    // Another desktop stopped it meanwhile; the deploy's own gates decide.
    case 'not-activated':
      return null
    case 'fenced': {
      // E.g. another desktop starting it after a reboot; a later connect pairs with it.
      const { cleared, ...refusal } = await madangdActivationFenceRefusal(slot, 'server start')
      if (cleared && retryClearedFence) {
        return adoptRunningMadangdVersion(slot, record, localVersion, false)
      }
      return { outcome: 'deferred', candidateVersion: localVersion, ...refusal, forceable: false }
    }
    case 'unverifiable':
      throw new MadangdActiveReadinessError(
        'unverifiable',
        `Madang ${record.active} runs this host's server, but its process state is unverifiable, ` +
          'so it was left as it is. Try connecting again.'
      )
    case 'recovery-refused':
      throw new Error(wake.reason)
    case 'serving':
    case 'started':
      break
  }
  // Re-read activation because wake follows peer changes to the current record.
  const active = (await readMadangdActivationRecord(slot)).active
  if (!active || active === localVersion) {
    return null
  }
  const identity = await resolveMadangdSlotIdentity(slot, active)
  const reprobe = () =>
    probeActiveMadangdReadiness(
      { ...slot, remoteInstallDir: identity.remoteDir },
      { buildHash: identity.buildHash, fullVersion: identity.version }
    )
  return { version: active, readiness: await reprobe(), reprobe }
}
