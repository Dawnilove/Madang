import { wakeStoppedManagedMadangd } from '../managed-server/lifecycle/madangd-managed-wake'
import type { MadangdSlotOptions } from './madangd-recovery-slot'

/** Already-active deploys launch nothing; wake that slot only on proven exit, including after reboot. Return whether it was started. */
export async function wakeAlreadyActiveMadangd(options: MadangdSlotOptions): Promise<boolean> {
  const wake = await wakeStoppedManagedMadangd(options)
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return wake.outcome === 'started'
}
