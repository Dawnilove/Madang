// Madangd exit does not prove terminal exit: the terminal daemon can outlive the server.
import { MADANGD_FENCE_OWNER_FILENAME } from '../activation/madangd-activation-fence-scope'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readMadangdActivationRecord } from '../activation/madangd-activation-record-store'
import { randomUUID } from 'node:crypto'
import {
  madangdActivationFenceExists,
  releaseMadangdActivationFence,
  withMadangdActivationLock
} from '../activation/madangd-activation-lock'
import { madangdLivenessProvenExited } from '../install/madangd-remote-launch'
import { readBoundedMadangdRemoteRecord } from '../install/madangd-remote-record-file'
import { madangdActivationFenceLockDir } from '../activation/madangd-activation-transaction'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'

import { readMadangdActivationTransaction } from '../activation/madangd-activation-transaction-store'
import {
  MADANGD_RECOVERY_UNVERIFIABLE_CODE,
  recoverInterruptedMadangdActivation
} from '../activation/madangd-activation-recovery'
import {
  ensureMadangdSlotServing,
  madangdSlotDir,
  resolveMadangdSlotIdentity,
  slotLiveness,
  type MadangdSlotOptions
} from '../../ssh/madangd-recovery-slot'

type MadangdManagedWake =
  | { outcome: 'serving' | 'not-activated' | 'unverifiable' }
  | { outcome: 'fenced' }
  | { outcome: 'started'; readiness: ServeReadiness }
  | { outcome: 'recovery-refused'; reason: string }

/** Start only proven-stopped active slots; leave live or unverifiable processes alone. */
export function wakeStoppedManagedMadangd(
  options: MadangdSlotOptions,
  onStarting: () => void = () => {}
): Promise<MadangdManagedWake> {
  const host = wakeHostKey(options)
  // Serialize per host before remote work so reconnect cannot race an earlier wake's unexplained fence.
  const prior = runningWakes.get(host)
  const wake = (async (): Promise<MadangdManagedWake> => {
    await prior?.catch(() => {})
    return wakeAfterPrior(options, host, onStarting)
  })()
  runningWakes.set(host, wake)
  void wake
    .catch(() => {})
    .finally(() => {
      if (runningWakes.get(host) === wake) {
        runningWakes.delete(host)
      }
    })
  return wake
}

async function wakeAfterPrior(
  options: MadangdSlotOptions,
  host: string,
  onStarting: () => void
): Promise<MadangdManagedWake> {
  const before = await readMadangdActivationRecord(options)
  if (!before.active) {
    return { outcome: 'not-activated' }
  }
  const liveness = await slotLiveness(options, madangdSlotDir(options, before.active))
  if (!madangdLivenessProvenExited(liveness)) {
    return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
  }
  if (!(await madangdActivationFenceExists(options))) {
    interruptedWakes.delete(host)
  } else if (!(await releaseOwnInterruptedWakeFence(options, host))) {
    const recovered = await recoverAbandonedFence(options, onStarting)
    if (recovered) {
      return recovered
    }
  }
  // Record ownership before acquisition: dropped replies can leave fences only this token can reclaim.
  const token = randomUUID()
  interruptedWakes.set(host, token)
  const result = await withMadangdActivationLock(
    options,
    async (): Promise<MadangdManagedWake> => {
      // Other clients may change the active slot; reread under the fence.
      const active = (await readMadangdActivationRecord(options)).active
      if (!active) {
        return { outcome: 'not-activated' }
      }
      const identity = await resolveMadangdSlotIdentity(options, active)
      onStarting()
      return { outcome: 'started', readiness: await ensureMadangdSlotServing(options, identity) }
    },
    (): MadangdManagedWake => ({ outcome: 'fenced' }),
    token
  )
  if (interruptedWakes.get(host) === token) {
    interruptedWakes.delete(host)
  }
  return result
}

/** Recover abandoned journals under stale, previous-boot or proven-exited fences; busy runs retain ownership. */
async function recoverAbandonedFence(
  options: MadangdSlotOptions,
  onStarting: () => void
): Promise<MadangdManagedWake | null> {
  const recovery = await recoverInterruptedMadangdActivation(options)
  switch (recovery.outcome) {
    case 'none':
      return null
    case 'pending':
      return { outcome: 'fenced' }
    case 'refused':
      // Retry unverifiable recovery at the next fence check, as with a busy owner.
      return recovery.code === MADANGD_RECOVERY_UNVERIFIABLE_CODE
        ? { outcome: 'fenced' }
        : { outcome: 'recovery-refused', reason: recovery.reason }
    case 'recovered':
      if (!recovery.readiness) {
        return { outcome: 'not-activated' }
      }
      onStarting()
      return { outcome: 'started', readiness: recovery.readiness }
  }
}

const runningWakes = new Map<string, Promise<MadangdManagedWake>>()

const interruptedWakes = new Map<string, string>()

function wakeOwnerPath(options: MadangdSlotOptions): string {
  return joinRemotePath(
    options.host,
    madangdActivationFenceLockDir(options.host, options.remoteHome),
    MADANGD_FENCE_OWNER_FILENAME
  )
}

function wakeHostKey(options: MadangdSlotOptions): string {
  return `${options.conn.getTarget().id}\0${options.remoteHome}`
}

/** Reclaim only this client's journal-free interrupted fence after proving slot exit. */
async function releaseOwnInterruptedWakeFence(
  options: MadangdSlotOptions,
  host: string
): Promise<boolean> {
  const token = interruptedWakes.get(host)
  if (!token || (await readMadangdActivationTransaction(options))) {
    return false
  }
  // A new owner may not have written its token yet; absence cannot prove this fence ours.
  const owner = await readBoundedMadangdRemoteRecord(options, wakeOwnerPath(options), 64)
  if (owner.state !== 'present' || owner.raw.trim() !== token) {
    interruptedWakes.delete(host)
    return false
  }
  await releaseMadangdActivationFence(options, token)
  interruptedWakes.delete(host)
  return true
}
