/** Retry live fences later, clear abandoned bare fences, and require recovery for interrupted journaled state. */
import {
  madangdActivationFenceExists,
  withStaleMadangdActivationRecoveryLock,
  type MadangdActivationLockOptions
} from './madangd-activation-lock'
import { readMadangdActivationTransaction } from './madangd-activation-transaction-store'
import { madangdActivationFenceLockDir } from './madangd-activation-transaction'
import { isRelayInstallLockStale } from '../install/remote-install-lock'
import { findExitedOwnLockToken } from '../../ssh/madangd-exited-own-lock'
import { madangdRemoteBaseDir } from '../install/madangd-remote-windows-node'

export const MADANGD_ACTIVATION_FENCE_BUSY_CODE = 'madangd_activation_fence_busy'
const MADANGD_ACTIVATION_RECOVERY_REQUIRED_CODE = 'madangd_activation_recovery_required'

type MadangdActivationFenceRefusal = {
  code: string
  reason: string
  /** Bare stale fence cleared; the caller may retry immediately. */
  cleared?: true
}

export async function madangdActivationFenceRefusal(
  options: MadangdActivationLockOptions,
  attempt: string
): Promise<MadangdActivationFenceRefusal> {
  const lockDir = madangdActivationFenceLockDir(options.host, options.remoteHome)
  const journal = (await readMadangdActivationTransaction(options).catch(() => null)) !== null
  const baseDir = madangdRemoteBaseDir(options.host, options.remoteHome)
  const stale =
    (await findExitedOwnLockToken(options, lockDir, { baseDir, guardsStateMutation: true })) !==
      null || (await isRelayInstallLockStale(options.conn, lockDir, options.host))
  if (stale && !journal && (await clearAbandonedFence(options))) {
    return {
      code: MADANGD_ACTIVATION_FENCE_BUSY_CODE,
      reason: `An abandoned fence held this host and was cleared; the ${attempt} is retried.`,
      cleared: true
    }
  }
  const stuck = stale || (journal && !(await madangdActivationFenceExists(options).catch(() => true)))
  return stuck
    ? {
        code: MADANGD_ACTIVATION_RECOVERY_REQUIRED_CODE,
        reason: `An interrupted update or stop holds this host, so the ${attempt} did not start. Recover it first.`
      }
    : {
        code: MADANGD_ACTIVATION_FENCE_BUSY_CODE,
        reason: `Another run is changing this host’s Madang server, so the ${attempt} did not start. It is retried on a later connect.`
      }
}

/** Drop a stale fence only after rechecking under takeover that no journal appeared. */
async function clearAbandonedFence(options: MadangdActivationLockOptions): Promise<boolean> {
  try {
    return await withStaleMadangdActivationRecoveryLock(options, async (lock) => {
      if (await readMadangdActivationTransaction(options)) {
        lock.retain()
        return false
      }
      return true
    })
  } catch {
    // Failed takeover leaves the fence intact for normal refusal classification.
    return false
  }
}
