import process from 'node:process'
import { profileStateAccessMachineIdentity } from '../persistence/profile-state/profile-state-access-identity'
import { readMadangdProcessIncarnation } from './madangd-process-start-time'
import { MadangdInstanceLockError } from './madangd-data-root-privacy'
import {
  madangdStaleLockReclaimCommand,
  type MadangdReclaimHintRuntime
} from '../../shared/madangd-stale-lock-reclaim'

/** Match machine identity, then legacy boot identity; identity-less records require local-only storage. */
export function madangdLockHolderLocality(
  holder: MadangdPeerMachine,
  self: MadangdPeerMachine,
  dataRootIsOnLocalDisk: () => boolean
): 'local' | 'foreign' | 'unknown' {
  if (holder.machineIdentity && self.machineIdentity) {
    return holder.machineIdentity === self.machineIdentity ? 'local' : 'foreign'
  }
  if (holder.bootId && holder.bootId === self.bootId) {
    return 'local'
  }
  return dataRootIsOnLocalDisk() ? 'local' : 'unknown'
}

export type MadangdPeerMachine = { machineIdentity?: string; bootId?: string }

export function currentMadangdPeerMachine(): MadangdPeerMachine {
  const machineIdentity = profileStateAccessMachineIdentity()
  const bootId = readMadangdProcessIncarnation(process.pid)?.bootId
  return { ...(machineIdentity ? { machineIdentity } : {}), ...(bootId ? { bootId } : {}) }
}

/** PIDs require a provable machine and boot match; unknown peers are never assumed exited. */
export function madangdPeerPidIsJudgeableHere(
  peer: MadangdPeerMachine,
  self: MadangdPeerMachine,
  dataRootIsOnLocalDisk: () => boolean
): boolean {
  if (peer.bootId && self.bootId && peer.bootId !== self.bootId) {
    return false
  }
  return madangdLockHolderLocality(peer, self, dataRootIsOnLocalDisk) === 'local'
}

export function madangdLockHolderUnverifiableError(lock: {
  holder: string
  foreign: boolean
  dataRoot: string
  lockPath: string
  /** Managed hosts may lack launchers on PATH, so name this runtime/entry in reclaim hints. */
  hintRuntime: MadangdReclaimHintRuntime | null
}): MadangdInstanceLockError {
  const command = madangdStaleLockReclaimCommand(lock.dataRoot, lock.hintRuntime)
  const reclaim =
    process.platform === 'linux'
      ? `run \`${command}\` on the machine it ran on to check and clear it, or `
      : ''
  return new MadangdInstanceLockError(
    'madangd_instance_lock_holder_unverifiable',
    `${lock.holder} holds the data root ${lock.dataRoot}${lock.foreign ? ' from another machine' : ''}. ` +
      'Madang cannot check from here whether it is still running, because this data root may be ' +
      `shared with other machines. Stop it there. If it is not running anywhere, ${reclaim}` +
      `delete ${lock.lockPath} once you are sure.`
  )
}
