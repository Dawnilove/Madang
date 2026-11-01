import {
  planManagedMadangdAutoUpdate,
  type ManagedMadangdAutoUpdateSkip
} from './madangd-managed-update-decision'
import { materializeMadangdArtifact } from '../../madangd/madangd-artifact-materializer'
import {
  MadangdArtifactsUnavailableError,
  MadangdHostUnsupportedError
} from '../../madangd/madangd-host-unavailable'
import { findIncompleteManagedMadangdMigration } from './madangd-managed-migration-status'
import { MADANGD_ACTIVATION_FENCE_BUSY_CODE } from '../activation/madangd-activation-fence-hold'
import { resolveLinkedMadangdContext } from './madangd-managed-runtime-context'
import {
  runManagedMadangdUpdate,
  withManagedMadangdLifecycle
} from '../../ssh/madangd-runtime-maintenance'
import type { MadangdUpdateDeferCode } from '../../ssh/madangd-update-plan'
import { readLocalFullVersion } from '../install/remote-versioned-install'

export type ManagedMadangdAutoUpdateOutcome =
  | { outcome: 'skipped'; reason: ManagedMadangdAutoUpdateSkip }
  | { outcome: 'updated'; activeVersion: string }
  | { outcome: 'deferred'; code: string; reason: string }
  /** Candidate rejection or update failure; consult host state before assuming the incumbent serves. */
  | { outcome: 'failed'; reason: string }

const WAITING_CODES: ReadonlySet<string> = new Set<
  MadangdUpdateDeferCode | typeof MADANGD_ACTIVATION_FENCE_BUSY_CODE
>([
  MADANGD_ACTIVATION_FENCE_BUSY_CODE,
  'madangd_update_terminals_running',
  'madangd_update_terminal_census_unavailable',
  'madangd_update_strands_live_terminals',
  'madangd_update_daemon_protocol_unverifiable',
  'madangd_update_ends_in_process_terminals'
])

/** Temporary deferrals retry on later connects; interrupted activations require recovery. */
export function isWaitingMadangdUpdateDeferral(code: string): boolean {
  return WAITING_CODES.has(code)
}

export function autoUpdateManagedMadangdEnvironment(
  userDataPath: string,
  args: {
    environmentId: string
    appVersion: string
    /** Read under the lifecycle lock to observe prior overlapping attempts. */
    failedBefore: () => boolean
    onUpdating: () => void
  }
): Promise<ManagedMadangdAutoUpdateOutcome> {
  return withManagedMadangdLifecycle(userDataPath, args.environmentId, async (managed) => {
    // Restarting during migration would race cutover staging.
    if (findIncompleteManagedMadangdMigration(userDataPath, managed.environment.id)) {
      return { outcome: 'skipped', reason: 'migrating' }
    }
    const context = await resolveLinkedMadangdContext(managed.environment, managed.deployment)
    const candidateVersion = await bundledManagedMadangdVersion(context.serverTarget)
    const plan = planManagedMadangdAutoUpdate({
      record: context.activationRecord,
      candidateVersion,
      appVersion: args.appVersion,
      failedBefore: args.failedBefore()
    })
    if (plan.action === 'skip') {
      return { outcome: 'skipped', reason: plan.reason }
    }
    args.onUpdating()
    let lockedSkip: ManagedMadangdAutoUpdateSkip | null = null
    try {
      const result = await runManagedMadangdUpdate(userDataPath, managed, context, {
        // Another desktop may activate or stop a newer build during upload; recheck under the fence.
        admitRecord: (record) => {
          const locked = planManagedMadangdAutoUpdate({
            record,
            candidateVersion,
            appVersion: args.appVersion,
            failedBefore: false
          })
          if (locked.action === 'update') {
            return null
          }
          lockedSkip = locked.reason
          return `Auto-update skipped under the host fence: ${locked.reason}.`
        }
      })
      if (lockedSkip) {
        return { outcome: 'skipped', reason: lockedSkip }
      }
      if (result.outcome !== 'deferred') {
        return { outcome: 'updated', activeVersion: result.activeVersion }
      }
      return isWaitingMadangdUpdateDeferral(result.code)
        ? { outcome: 'deferred', code: result.code, reason: result.reason }
        : { outcome: 'failed', reason: result.reason }
    } catch (error) {
      return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
  })
}

type MadangdTarget = Parameters<typeof materializeMadangdArtifact>[0]

// Packaged templates cannot change during this session; avoid repeated hashing.
const bundledVersions = new Map<MadangdTarget, Promise<string | null>>()

/** This build's madangd version for `target`; null when the build bundles none for it. */
export function bundledManagedMadangdVersion(target: MadangdTarget): Promise<string | null> {
  let version = bundledVersions.get(target)
  if (!version) {
    version = materializeMadangdArtifact(target).then(readLocalFullVersion, (error: unknown) => {
      if (
        error instanceof MadangdHostUnsupportedError ||
        error instanceof MadangdArtifactsUnavailableError
      ) {
        return null
      }
      throw error
    })
    // A transient local failure must not stick for the session.
    version.catch(() => bundledVersions.delete(target))
    bundledVersions.set(target, version)
  }
  return version
}

export function resetBundledMadangdVersionsForTests(): void {
  bundledVersions.clear()
}
