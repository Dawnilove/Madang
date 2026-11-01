/** Adopt serving unrecorded madangd under the activation fence only when lock, readiness and installed build identify the same process. Never kill it without census; launching another loses the instance lock. Normal update admission handles version changes. */
import {
  MADANGD_LOCK_FILE_NAME,
  parseMadangdInstanceLockRecord,
  type MadangdLockRecord
} from '../madangd/madangd-instance-lock'
import { compareMadangdProcessIdentity } from '../madangd/madangd-process-start-time'
import type { MadangdActivationRecord } from '../managed-server/activation/madangd-activation-record'
import {
  readMadangdActivationRecord,
  writeMadangdActivationRecord
} from '../managed-server/activation/madangd-activation-record-store'
import { evaluateMadangdActivation } from '../managed-server/activation/madangd-activation-gate'
import { withMadangdActivationLock } from '../managed-server/activation/madangd-activation-lock'
import { sameMadangdActivationRecord } from '../managed-server/activation/madangd-activation-transaction'
import { readMadangdActivationTransaction } from '../managed-server/activation/madangd-activation-transaction-store'
import { readRemoteMadangdManagedStopTarget } from '../managed-server/lifecycle/madangd-managed-remote-stop'
import {
  madangdSlotDir,
  resolveMadangdSlotIdentity,
  type MadangdSlotOptions
} from '../ssh/madangd-recovery-slot'
import { MADANGD_PID_FILENAME } from '../managed-server/install/madangd-remote-host-support'
import {
  parseMadangdReadinessWaitOutput,
  readMadangdReadinessNowCommand
} from '../managed-server/install/madangd-remote-readiness-wait'
import { readBoundedMadangdRemoteRecord } from '../managed-server/install/madangd-remote-record-file'
import { execMadangdRemote } from '../managed-server/install/madangd-remote-runtime-control'
import {
  MADANGD_INSTALL_MODEL,
  remoteInstallDirName,
  remoteInstallVersionDirRegex
} from '../managed-server/install/remote-install-model'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import { readWslGuestIdentity, wslGuestMadangdIncarnation } from './wsl-guest-process-identity'

const LOCK_RECORD_MAX_BYTES = 64 * 1024
const UNRECORDED_MADANGD_CODE = 'wsl_madangd_unrecorded_instance_unverifiable'

export type WslMadangdAdoption =
  | { outcome: 'none' }
  | { outcome: 'adopted'; version: string; pid: number; record: MadangdActivationRecord }

export class WslMadangdUnrecordedInstanceError extends Error {
  readonly code = UNRECORDED_MADANGD_CODE
  constructor(message: string) {
    super(message)
    this.name = 'WslMadangdUnrecordedInstanceError'
  }
}

type LockHolder = { pid: number; version: string }

async function readLiveLockHolder(slot: MadangdSlotOptions): Promise<LockHolder | null> {
  const lockPath = joinRemotePath(slot.host, slot.userDataDir, MADANGD_LOCK_FILE_NAME)
  const read = await readBoundedMadangdRemoteRecord(slot, lockPath, LOCK_RECORD_MAX_BYTES)
  const lock = read.state === 'present' ? parseMadangdInstanceLockRecord(read.raw) : null
  // Desktop-role or malformed locks identify no madangd to adopt.
  if (!lock || lock.role === 'desktop') {
    return null
  }
  // Adopt only proven-live holders; otherwise let the host's instance lock arbitrate launch.
  return (await lockHolderLiveness(slot, lock)) === 'live'
    ? { pid: lock.pid, version: lock.version }
    : null
}

type LockHolderLiveness = 'live' | 'unverifiable' | 'exited'

/** A PID is no identity after a distro restart reuses it: the lock's boot id and start ticks are. */
async function lockHolderLiveness(
  slot: MadangdSlotOptions,
  lock: MadangdLockRecord
): Promise<LockHolderLiveness> {
  const guest = await readWslGuestIdentity(slot.conn, lock.pid)
  if (!guest) {
    return 'unverifiable'
  }
  const incarnation = wslGuestMadangdIncarnation(guest)
  // The guest answered, and no process has that PID.
  if (!incarnation) {
    return 'exited'
  }
  // Compare boot IDs case-insensitively because readers normalize them.
  const recorded = lock.bootId ? { ...lock, bootId: lock.bootId.toLowerCase() } : lock
  const verdict = compareMadangdProcessIdentity(lock.pid, recorded, {
    incarnation: () => incarnation,
    // Ignore wall-clock starts: guest clocks jump after host sleep.
    startedAtMs: () => null,
    platform: 'linux'
  })
  return verdict === 'matches' ? 'live' : verdict === 'differs' ? 'exited' : 'unverifiable'
}

async function readSlotPid(slot: MadangdSlotOptions, version: string): Promise<number | null> {
  const pidFile = joinRemotePath(slot.host, madangdSlotDir(slot, version), MADANGD_PID_FILENAME)
  const raw = await execMadangdRemote(slot, `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`)
  const pid = Number.parseInt(raw.trim(), 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

/** The holder's slot must publish readiness for this pid, from the build installed there. */
async function proveHolderServesItsSlot(slot: MadangdSlotOptions, holder: LockHolder): Promise<void> {
  const label = `An madangd (pid ${holder.pid}, ${holder.version}) is running in this distro but is not the recorded one`
  const dirName = remoteInstallDirName(MADANGD_INSTALL_MODEL, holder.version)
  if (!remoteInstallVersionDirRegex(MADANGD_INSTALL_MODEL).test(dirName)) {
    throw new WslMadangdUnrecordedInstanceError(`${label}, and its version is not a slot name.`)
  }
  const target = await readRemoteMadangdManagedStopTarget(slot, holder.version)
  if (target.state !== 'ready' || target.context.instance.pid !== holder.pid) {
    throw new WslMadangdUnrecordedInstanceError(
      `${label}, and it cannot be identified: ${target.state === 'refused' ? target.reason : 'its readiness names another process.'}`
    )
  }
  const identity = await resolveMadangdSlotIdentity(slot, holder.version)
  const readiness = parseMadangdReadinessWaitOutput(
    slot.host,
    await execMadangdRemote(slot, readMadangdReadinessNowCommand(slot.host, identity.remoteDir))
  )
  const verdict = evaluateMadangdActivation(
    readiness.state === 'ready' ? readiness.readiness : null,
    {
      buildHash: identity.buildHash,
      fullVersion: identity.version
    }
  )
  if (verdict.decision === 'reject') {
    throw new WslMadangdUnrecordedInstanceError(`${label}, and ${verdict.reason}`)
  }
}

function adoptedRecord(
  record: MadangdActivationRecord,
  version: string,
  now: Date
): MadangdActivationRecord {
  if (record.active === version) {
    return record
  }
  const { activeAppVersion, previousAppVersion: _previousAppVersion, ...rest } = record
  return {
    ...rest,
    active: version,
    previous: record.active ?? record.previous,
    ...(record.active && activeAppVersion ? { previousAppVersion: activeAppVersion } : {}),
    activatedAt: now.toISOString(),
    // Prelaunch snapshot belongs to another activation; rollback must not restore it.
    snapshot: null
  }
}

/** Adopt lock owners missing from record/pid file only with proof; otherwise refuse rather than launch into an occupied instance lock. */
export async function adoptUnrecordedWslMadangd(
  slot: MadangdSlotOptions,
  record: MadangdActivationRecord,
  now: () => Date = () => new Date()
): Promise<WslMadangdAdoption> {
  const holder = await readLiveLockHolder(slot)
  if (!holder) {
    return { outcome: 'none' }
  }
  if (
    record.active === holder.version &&
    (await readSlotPid(slot, holder.version)) === holder.pid
  ) {
    return { outcome: 'none' }
  }
  await proveHolderServesItsSlot(slot, holder)
  return withMadangdActivationLock(
    slot,
    async () => {
      const current = await readMadangdActivationRecord(slot)
      if (!sameMadangdActivationRecord(current, record)) {
        throw new WslMadangdUnrecordedInstanceError(
          'The activation record changed while an unrecorded madangd was being adopted. Retry.'
        )
      }
      if (await readMadangdActivationTransaction(slot)) {
        throw new WslMadangdUnrecordedInstanceError(
          'An interrupted activation is pending, so an unrecorded madangd cannot be adopted yet.'
        )
      }
      const again = await readLiveLockHolder(slot)
      if (again?.pid !== holder.pid || again.version !== holder.version) {
        throw new WslMadangdUnrecordedInstanceError(
          'The unrecorded madangd changed while it was being adopted. Retry.'
        )
      }
      const pidFile = joinRemotePath(
        slot.host,
        madangdSlotDir(slot, holder.version),
        MADANGD_PID_FILENAME
      )
      await execMadangdRemote(
        slot,
        `(umask 077 && printf '%s\\n' ${String(holder.pid)} > ${quotePosixShell(pidFile)})`
      )
      const next = adoptedRecord(current, holder.version, now())
      if (next !== current) {
        await writeMadangdActivationRecord(slot, next)
      }
      return {
        outcome: 'adopted' as const,
        version: holder.version,
        pid: holder.pid,
        record: next
      }
    },
    () => {
      throw new WslMadangdUnrecordedInstanceError(
        'Another Madang is changing this distro’s server, so an unrecorded madangd cannot be adopted now.'
      )
    }
  )
}
