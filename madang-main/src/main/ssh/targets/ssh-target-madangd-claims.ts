/** madangdFence reserves a target for its managed tunnel and refuses direct relay access. Claim only empty targets; existing state requires catalog migration. */
import type { Store } from '../../persistence'
import {
  getManagedMadangdFenceEnvironmentId,
  isEphemeralRuntimeSshOwner
} from '../../../shared/managed-madangd-ssh-owner'
import type {
  MadangdMigrationBlocker,
  MadangdMigrationPreflight
} from '../../../shared/madangd-migration/madangd-migration-preflight'
import type { SshTarget } from '../../../shared/ssh-types'
import {
  collectDependentStateBlockers,
  dependentStateMessage,
  type DependentStateStore
} from './ssh-target-madangd-dependents'

type ClaimStore = DependentStateStore &
  Pick<
    Store,
    | 'allocateSshTargetGeneration'
    | 'flushPendingOrThrowAsync'
    | 'getFolderWorkspaces'
    | 'getRepos'
    | 'getSshTarget'
    | 'getSshTargets'
    | 'updateSshTarget'
  >

export class SshTargetMadangdClaims {
  constructor(private readonly store: ClaimStore) {}

  listTargets(): SshTarget[] {
    return this.store.getSshTargets()
  }

  /** Reuse an own claim only when a durable provisioning/SSH-access intent or migration journal explains it. */
  preflight(
    targetId: string,
    owner?: { environmentId: string; recorded: boolean }
  ): MadangdMigrationPreflight {
    const resolved = resolveMadangdPreflightTarget(this.store, targetId, owner)
    if ('result' in resolved) {
      return resolved.result
    }
    const { target } = resolved
    const blockers = collectEmptyTargetBlockers(this.store, target)
    return { targetId, targetLabel: target.label, claimable: blockers.length === 0, blockers }
  }

  /** Caller must persist the claim before remote action; deployName identifies interrupted provisioning. */
  claim(
    targetId: string,
    environmentId: string,
    options: { deployName?: string; ownerRecorded: boolean }
  ): SshTarget {
    const { deployName } = options
    const blocker = this.preflight(targetId, {
      environmentId,
      recorded: options.ownerRecorded
    }).blockers[0]
    if (blocker) {
      throw new Error(madangdTargetBlockerMessage(targetId, blocker))
    }
    const target = this.requireTarget(targetId)
    const owned = getManagedMadangdFenceEnvironmentId(target) === environmentId
    if (owned && target.generation) {
      return target
    }
    const claimed = this.store.updateSshTarget(targetId, {
      madangdFence: { environmentId },
      generation: target.generation ?? this.store.allocateSshTargetGeneration(),
      ...(deployName && !target.madangdProvisioning
        ? { madangdProvisioning: { requestId: environmentId, name: deployName } }
        : {})
    })
    if (!claimed) {
      throw new Error(`SSH target "${targetId}" disappeared while it was being reserved.`)
    }
    return claimed
  }

  /** A durable registration generation, so a fence and its journal bind to one registration. */
  ensureGeneration(targetId: string): number {
    const target = this.requireTarget(targetId)
    if (target.generation !== undefined) {
      return target.generation
    }
    const generation = this.store.allocateSshTargetGeneration()
    if (!this.store.updateSshTarget(targetId, { generation })) {
      throw new Error(`SSH target "${targetId}" disappeared while assigning its generation.`)
    }
    return generation
  }

  /** Skip empty-target checks only after conversion preflight and a durable migration journal. */
  fenceForMigration(targetId: string, environmentId: string, generation: number): SshTarget {
    const target = this.requireTarget(targetId)
    if (target.generation !== generation) {
      throw new Error('madangd_migration_target_generation_changed')
    }
    const holder = targetHolder(target)
    if (holder && !(holder.kind === 'managed-server' && holder.environmentId === environmentId)) {
      throw new Error(
        madangdTargetBlockerMessage(targetId, {
          code: 'madangd_migration_target_owned',
          category: 'exclusive-ownership',
          holder
        })
      )
    }
    const fenced = this.store.updateSshTarget(targetId, { madangdFence: { environmentId } })
    if (!fenced) {
      throw new Error(`SSH target "${targetId}" disappeared while it was being fenced.`)
    }
    return fenced
  }

  release(targetId: string, environmentId: string): SshTarget | null {
    const target = this.store.getSshTarget(targetId)
    if (!target || getManagedMadangdFenceEnvironmentId(target) !== environmentId) {
      return null
    }
    return this.store.updateSshTarget(targetId, {
      madangdFence: undefined,
      madangdProvisioning: undefined
    })
  }

  /** Ownership must be on disk before a remote host acts on it. */
  flush(signal?: AbortSignal): Promise<void> {
    return this.store.flushPendingOrThrowAsync({ signal, drainToStableGeneration: false })
  }

  private requireTarget(targetId: string): SshTarget {
    const target = this.store.getSshTarget(targetId)
    if (!target) {
      throw new Error(`SSH target "${targetId}" not found.`)
    }
    return target
  }
}

/** An own fence requires a durable owner record for both claim and export preflight. */
export function resolveMadangdPreflightTarget(
  store: Pick<Store, 'getSshTarget'>,
  targetId: string,
  owner?: { environmentId: string; recorded: boolean }
): { result: MadangdMigrationPreflight } | { target: SshTarget } {
  const target = store.getSshTarget(targetId)
  if (!target) {
    return {
      result: {
        targetId,
        targetLabel: null,
        claimable: false,
        blockers: [{ code: 'madangd_migration_target_not_found', category: 'registration' }]
      }
    }
  }
  if (!owner || getManagedMadangdFenceEnvironmentId(target) !== owner.environmentId) {
    return { target }
  }
  return {
    result: owner.recorded
      ? { targetId, targetLabel: target.label, claimable: true, blockers: [] }
      : {
          targetId,
          targetLabel: target.label,
          claimable: false,
          blockers: [{ code: 'madangd_migration_owner_unrecorded', category: 'exclusive-ownership' }]
        }
  }
}

function collectEmptyTargetBlockers(store: ClaimStore, target: SshTarget): MadangdMigrationBlocker[] {
  return [
    ...collectTargetCatalogBlockers(store, target),
    ...collectDependentStateBlockers(store, target.id)
  ]
}

export function collectTargetCatalogBlockers(
  store: Pick<Store, 'getFolderWorkspaces' | 'getRepos'>,
  target: SshTarget
): MadangdMigrationBlocker[] {
  const blockers: MadangdMigrationBlocker[] = []
  const holder = targetHolder(target)
  if (holder) {
    blockers.push({ code: 'madangd_migration_target_owned', category: 'exclusive-ownership', holder })
  }
  const repositories = store
    .getRepos()
    .filter((repo) => repo.connectionId === target.id)
    .map(({ id, path, displayName, kind }) => ({ id, path, displayName, kind }))
  if (repositories.length > 0) {
    blockers.push({
      code: 'madangd_migration_direct_ssh_repositories',
      category: 'drainable-static-state',
      repositories
    })
  }
  const folderWorkspaces = store
    .getFolderWorkspaces()
    .filter((workspace) => workspace.connectionId === target.id)
    .map(({ id, name, folderPath }) => ({ id, name, folderPath }))
  if (folderWorkspaces.length > 0) {
    blockers.push({
      code: 'madangd_migration_direct_ssh_folder_workspaces',
      category: 'drainable-static-state',
      folderWorkspaces
    })
  }
  if (target.portForwards?.length) {
    blockers.push({
      code: 'madangd_migration_saved_port_forwards',
      category: 'client-owned-state',
      portForwards: target.portForwards.map((portForward) => ({ ...portForward }))
    })
  }
  return blockers
}

/** Who holds the target exclusively: a managed Orca server, or an unmigrated legacy owner. */
function targetHolder(
  target: SshTarget
): Extract<MadangdMigrationBlocker, { code: 'madangd_migration_target_owned' }>['holder'] | null {
  // Why: a recipe VM's runtime owns when the host is created and destroyed, not which server runs it.
  if (target.owner && !isEphemeralRuntimeSshOwner(target.owner)) {
    return { kind: 'runtime', runtimeId: target.owner.runtimeId }
  }
  const environmentId = getManagedMadangdFenceEnvironmentId(target)
  return environmentId ? { kind: 'managed-server', environmentId } : null
}

export function madangdTargetBlockerMessage(
  targetId: string,
  blocker: MadangdMigrationBlocker
): string {
  switch (blocker.code) {
    case 'madangd_migration_target_not_found':
      return `SSH target "${targetId}" not found.`
    case 'madangd_migration_target_owned':
      return 'This SSH target is already owned by another managed runtime.'
    case 'madangd_migration_owner_unrecorded':
      return 'This SSH target is held for this server, but no record explains why. Recover the server before reusing the host.'
    case 'madangd_migration_direct_ssh_repositories':
    case 'madangd_migration_direct_ssh_folder_workspaces':
      return 'This SSH target owns repositories or folder workspaces. Madang can only be set up on a host with no direct SSH projects yet; keep this host in direct SSH mode.'
    case 'madangd_migration_direct_ssh_terminal_leases':
      return 'This SSH target still owns terminal sessions. Close them before converting the host.'
    case 'madangd_migration_saved_port_forwards':
      return 'This SSH target has saved port forwards. Remove them before converting the host.'
    case 'madangd_migration_dependent_state':
      return dependentStateMessage(blocker.dependencies)
    case 'madangd_migration_dependency_unverifiable':
      return `Madang could not read its saved ${blocker.sources.join(', ')} state, so it cannot show this SSH target is unused; the target was left in direct SSH mode.`
  }
}
