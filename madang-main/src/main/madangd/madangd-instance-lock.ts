// Lock before profile load to prevent concurrent writers; terminal daemons own separate endpoints
// and deliberately survive runtime lock release and restart.
import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { z } from 'zod'
import {
  compareMadangdProcessIdentity,
  readMadangdProcessIncarnation,
  readMadangdProcessName,
  readMadangdProcessStartedAtMs,
  type MadangdProcessIdentityVerdict,
  type MadangdProcessIncarnation
} from './madangd-process-start-time'
import {
  assertMadangdDataRootIsPrivate,
  MadangdInstanceLockError,
  type MadangdDataRootPrivacyHooks
} from './madangd-data-root-privacy'
import { hasErrorCode, isProcessAlive } from '../daemon/daemon-process-inspection'
import { profileStateAccessMachineIdentity } from '../persistence/profile-state/profile-state-access-identity'
import { madangdDataRootIsOnLocalDisk } from './madangd-data-root-locality'
import type { MadangdReclaimHintRuntime } from '../../shared/madangd-stale-lock-reclaim'
import {
  madangdLockHolderLocality,
  madangdLockHolderUnverifiableError
} from './madangd-lock-holder-locality'
import {
  MAX_MADANGD_LOCK_BYTES,
  readBoundedLockFile,
  reclaimAndPublish,
  unlinkQuietly,
  type MadangdLockRecoveryOwner
} from './madangd-instance-lock-reclaim'

export const MADANGD_LOCK_FILE_NAME = 'madangd.lock'
// Allow old torn writes time to complete before treating garbled records as abandoned.
const GARBLED_LOCK_GRACE_MS = 10_000

const MadangdLockRecordSchema = z.object({
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** Null means PID alone supplies the weaker fence. */
  startedAtMs: z.number().finite().nonnegative().nullable(),
  /** Drift-free Linux identity; tolerate unknown future encodings without losing the whole record. */
  linuxStartTicks: z.string().regex(/^\d+$/).max(32).optional().catch(undefined),
  bootId: z.string().min(1).max(255).optional().catch(undefined),
  identity: z.string().min(1).max(1_024),
  version: z.string().min(1).max(255),
  acquiredAt: z.iso.datetime({ offset: true }),
  nonce: z.string().min(1).max(255),
  /** Older pre-desktop-sharing records omit role. */
  role: z.enum(['madangd', 'desktop']).optional(),
  /** Shared homes require machine identity: foreign PIDs establish no local liveness. */
  machineIdentity: z.string().min(1).max(255).optional().catch(undefined),
  /** Optional legacy-compatible hostname for stale-lock reclaim hints. */
  host: z.string().min(1).max(255).optional().catch(undefined)
})

export type MadangdLockRecord = z.infer<typeof MadangdLockRecordSchema>

/** Unreadable/malformed/oversized/absent returns null; this does not prove the lock is free. */
export function readMadangdInstanceLockRecord(path: string): MadangdLockRecord | null {
  return parseMadangdInstanceLockRecord(readBoundedLockFile(path) ?? '')
}

export type MadangdInstanceLock = {
  readonly path: string
  readonly record: MadangdLockRecord
  release(): void
}

export type MadangdInstanceLockHooks = MadangdDataRootPrivacyHooks & {
  identity?: () => string
  version?: () => string
  now?: () => Date
  /** EPERM still proves the process exists. */
  processIsAlive?: (pid: number) => boolean
  startedAtMs?: (pid: number) => number | null
  incarnation?: (pid: number) => MadangdProcessIncarnation | null
  ownerUid?: (pid: number) => number | null
  processName?: (pid: number) => string | null
  /** Only differs can reject a live PID’s identity. */
  holderIdentity?: (record: MadangdLockRecord) => MadangdProcessIdentityVerdict
  /** Desktop callers must first hold Electron’s single-instance lock to reclaim desktop records. */
  role?: 'madangd' | 'desktop'
  machineIdentity?: () => string | null
  /** Establishes locality for legacy machine-less records. */
  dataRootIsOnLocalDisk?: (dataRoot: string) => boolean
  /** Explicit stale-reclaim confirmation permits judging otherwise unverifiable PIDs locally. */
  reclaimConfirmed?: (record: MadangdLockRecord, role: 'holder' | 'recovery-owner') => boolean
  reclaimHintRuntime?: MadangdReclaimHintRuntime | null
}

function defaultIdentity(): string {
  // POSIX names can repeat across containers; filesystem permissions enforce numeric UIDs.
  return process.platform === 'win32'
    ? (userInfo().username ?? 'unknown')
    : String(process.getuid?.() ?? 'unknown')
}

export function parseMadangdInstanceLockRecord(content: string): MadangdLockRecord | null {
  try {
    const result = MadangdLockRecordSchema.safeParse(JSON.parse(content))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/** Reclaim dead holders only; preserve live or foreign-identity ownership. */
export function acquireMadangdInstanceLock(
  dataRoot: string,
  hooks: MadangdInstanceLockHooks = {}
): MadangdInstanceLock {
  const identity = (hooks.identity ?? defaultIdentity)()
  const isAlive = hooks.processIsAlive ?? isProcessAlive
  const readStartedAt = hooks.startedAtMs ?? readMadangdProcessStartedAtMs
  const readIncarnation = hooks.incarnation ?? readMadangdProcessIncarnation
  const holderIdentity =
    hooks.holderIdentity ??
    ((holder: MadangdLockRecord) =>
      compareMadangdProcessIdentity(holder.pid, holder, {
        startedAtMs: readStartedAt,
        incarnation: readIncarnation,
        ownerUid: hooks.ownerUid,
        platform: hooks.platform
      }))

  try {
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  } catch (error) {
    throw new MadangdInstanceLockError(
      'madangd_data_root_unusable',
      `Cannot create the madangd data root ${dataRoot}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  // Desktop profiles retain existing permissions; madangd tightens its own roots.
  if ((hooks.role ?? 'madangd') === 'madangd') {
    assertMadangdDataRootIsPrivate(dataRoot, hooks)
  }

  const lockPath = join(dataRoot, MADANGD_LOCK_FILE_NAME)
  const machineIdentity = (hooks.machineIdentity ?? profileStateAccessMachineIdentity)()
  const record: MadangdLockRecord = {
    pid: process.pid,
    startedAtMs: readStartedAt(process.pid),
    ...readIncarnation(process.pid),
    identity,
    version: (hooks.version ?? (() => process.env.MADANG_VERSION ?? 'unknown'))(),
    acquiredAt: (hooks.now ?? (() => new Date()))().toISOString(),
    nonce: randomUUID(),
    role: hooks.role ?? 'madangd',
    ...(machineIdentity ? { machineIdentity } : {}),
    host: hostname()
  }
  const serialized = JSON.stringify(record)

  // Stage then hard-link so canonical records are always complete.
  const publish = (): boolean => {
    const staged = `${lockPath}.staged-${process.pid}-${randomUUID()}`
    try {
      writeFileSync(staged, serialized, { flag: 'wx', mode: 0o600 })
      linkSync(staged, lockPath)
      return true
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) {
        return false
      }
      throw new MadangdInstanceLockError(
        'madangd_data_root_unusable',
        `Cannot write the madangd instance lock ${lockPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      unlinkQuietly(staged)
    }
  }

  if (publish()) {
    return makeLock(lockPath, record)
  }

  const dataRootIsLocal = (): boolean =>
    (hooks.dataRootIsOnLocalDisk ?? madangdDataRootIsOnLocalDisk)(dataRoot)
  const judgedHere = (holder: MadangdLockRecord, role: 'holder' | 'recovery-owner'): boolean => {
    const locality = madangdLockHolderLocality(holder, record, dataRootIsLocal)
    return (
      locality === 'local' || (locality === 'unknown' && !!hooks.reclaimConfirmed?.(holder, role))
    )
  }
  const recoveryOwner: MadangdLockRecoveryOwner = {
    record: serialized,
    exited: (ownerRecord) => {
      const owner = parseMadangdInstanceLockRecord(ownerRecord)
      return Boolean(
        owner &&
        owner.identity === identity &&
        judgedHere(owner, 'recovery-owner') &&
        (!isAlive(owner.pid) || holderIdentity(owner) === 'differs')
      )
    }
  }

  const existingContents = readBoundedLockFile(lockPath)
  if (existingContents === null) {
    // Unreadable records cannot prove their holder exited.
    throw new MadangdInstanceLockError(
      'madangd_instance_lock_unreadable',
      `The madangd instance lock at ${lockPath} is unreadable or larger than ` +
        `${MAX_MADANGD_LOCK_BYTES} bytes. Refusing to reclaim it without proof that its holder ` +
        'has exited. Stop madangd and remove the stale lock manually.'
    )
  }
  const existing = parseMadangdInstanceLockRecord(existingContents)
  if (!existing) {
    // Old torn writes become reclaimable only after the writer grace period.
    if (garbledLockIsAbandoned(lockPath)) {
      reclaimAndPublish(lockPath, dataRoot, existingContents, publish, recoveryOwner)
      return makeLock(lockPath, record)
    }
    throw new MadangdInstanceLockError(
      'madangd_instance_lock_held',
      `The madangd instance lock at ${lockPath} is still being written by another process. Retry.`
    )
  }
  if (existing.identity !== identity) {
    throw new MadangdInstanceLockError(
      'madangd_instance_lock_foreign_identity',
      `The madangd data root ${dataRoot} is locked by identity ${existing.identity} (pid ` +
        `${existing.pid}); this process runs as ${identity}. Two identities sharing one data ` +
        'root corrupts it. Give each its own MADANG_USER_DATA.'
    )
  }
  if (!judgedHere(existing, 'holder')) {
    // Foreign/unverifiable PIDs prove neither absence nor reuse here.
    throw madangdLockHolderUnverifiableError({
      holder: `${describeLockHolder(existing)} (pid ${existing.pid}, started ${existing.acquiredAt})`,
      foreign: madangdLockHolderLocality(existing, record, dataRootIsLocal) === 'foreign',
      dataRoot,
      lockPath,
      hintRuntime:
        hooks.reclaimHintRuntime !== undefined
          ? hooks.reclaimHintRuntime
          : hooks.role === 'desktop'
            ? null
            : { execPath: process.execPath, entry: process.argv[1] }
    })
  }
  // Electron’s already-held lock proves other desktop instances absent despite PID reuse.
  const staleDesktopRecord = hooks.role === 'desktop' && existing.role === 'desktop'
  const verdict = staleDesktopRecord || !isAlive(existing.pid) ? null : holderIdentity(existing)
  if (verdict === 'unproven' && !existing.bootId) {
    throw possiblyReusedPidError(lockPath, existing, hooks.processName ?? readMadangdProcessName)
  }
  if (verdict !== null && verdict !== 'differs') {
    throw new MadangdInstanceLockError(
      'madangd_instance_lock_held',
      `${describeLockHolder(existing)} (pid ${existing.pid}, started ` +
        `${existing.acquiredAt || 'unknown'}) already owns the data root ${dataRoot}. Stop it ` +
        'before starting another, or use a different MADANG_USER_DATA.'
    )
  }
  reclaimAndPublish(lockPath, dataRoot, existingContents, publish, recoveryOwner)
  return makeLock(lockPath, record)
}

function possiblyReusedPidError(
  lockPath: string,
  existing: MadangdLockRecord,
  processName: (pid: number) => string | null
): MadangdInstanceLockError {
  const name = processName(existing.pid)
  const holder = existing.role === 'desktop' ? 'the Madang desktop app' : 'madangd'
  return new MadangdInstanceLockError(
    'madangd_instance_lock_held',
    `The madangd instance lock at ${lockPath} names pid ${existing.pid}, which is still running ` +
      `(as ${name ? `"${name}"` : 'an unknown program'}). This lock, written by ${holder} at ` +
      `${existing.acquiredAt}, does not record which boot it came from, so Madang cannot tell ` +
      `whether that process is still ${holder} or an unrelated program that reused the PID. ` +
      `If you are sure ${holder} is not running for this data root, delete ${lockPath} and ` +
      'try again, or use a different MADANG_USER_DATA.'
  )
}

function garbledLockIsAbandoned(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > GARBLED_LOCK_GRACE_MS
  } catch {
    return false
  }
}

function describeLockHolder(record: MadangdLockRecord): string {
  return record.role === 'desktop' ? 'The Madang desktop app' : 'Another madangd'
}

function makeLock(lockPath: string, record: MadangdLockRecord): MadangdInstanceLock {
  let released = false
  return {
    path: lockPath,
    record,
    release: () => {
      if (released) {
        return
      }
      released = true
      // Re-read ownership before unlinking so a successor’s live runtime cannot be unlocked.
      const current = parseMadangdInstanceLockRecord(readBoundedLockFile(lockPath) ?? '')
      if (!current || current.nonce !== record.nonce) {
        return
      }
      try {
        unlinkSync(lockPath)
      } catch {
        // Dead-PID leftovers can be reclaimed on the next start.
      }
    }
  }
}
