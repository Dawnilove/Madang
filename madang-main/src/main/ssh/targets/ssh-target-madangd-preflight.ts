/** Read-only export preflight: catalog rows and representable dormant state can migrate; ownership, live leases and untransferred dependencies block. */
import { isLiveSshPtyLease } from '../../../shared/ssh-types'
import type { Store } from '../../persistence'
import type {
  MadangdMigrationBlocker,
  MadangdMigrationPreflight
} from '../../../shared/madangd-migration/madangd-migration-preflight'
import {
  createMadangdMigrationManifest,
  type MadangdMigrationExportStore
} from '../madangd-migration-manifest-export'
import {
  collectTargetCatalogBlockers,
  resolveMadangdPreflightTarget
} from './ssh-target-madangd-claims'
import { collectUntransferredDependentBlockers } from './ssh-target-madangd-dependents'
import {
  preservesMadangdMigrationBridgedPanes,
  type MadangdMigrationPaneLeasePredicate
} from '../madangd-migration-bridged-panes'

export type MadangdMigrationPreflightStore = MadangdMigrationExportStore &
  Pick<
    Store,
    'getSshTarget' | 'getSshRemotePtyLeases' | 'inspectMadangdMigrationUntransferredDependencies'
  >

/** `owner` passes the environment's own fence only when its migration journal is on disk. */
export function preflightMadangdMigrationExport(
  store: MadangdMigrationPreflightStore,
  targetId: string,
  owner?: { environmentId: string; recorded: boolean },
  /** COMPAT(legacy-relay-bridge): leases a bridged proof left running for the bridge. */
  bridgedPtyIds: readonly string[] = []
): MadangdMigrationPreflight {
  const resolved = resolveMadangdPreflightTarget(store, targetId, owner)
  if ('result' in resolved) {
    return resolved.result
  }
  const { target } = resolved
  const blockers: MadangdMigrationBlocker[] = [...collectTargetCatalogBlockers(store, target)]
  const terminalLeases = store
    .getSshRemotePtyLeases(targetId)
    .filter((lease) => isLiveSshPtyLease(lease) && !bridgedPtyIds.includes(lease.ptyId))
    .map(({ ptyId, worktreeId, tabId, leafId, state, updatedAt }) => ({
      ptyId,
      worktreeId,
      tabId,
      leafId,
      state,
      updatedAt
    }))
  if (terminalLeases.length > 0) {
    // A relay PTY cannot move to madangd; its work must finish first.
    blockers.push({
      code: 'madangd_migration_direct_ssh_terminal_leases',
      category: 'live-or-unverifiable',
      terminalLeases
    })
  }
  blockers.push(
    ...collectUntransferredDependentBlockers(store, createMadangdMigrationManifest(store, target))
  )
  return {
    targetId,
    targetLabel: target.label,
    claimable: !blockers.some(isBlockingMadangdMigrationBlocker),
    blockers
  }
}

/** Confirmed Move anyway can leave saved state, but desktop drafts that cannot be left still block. */
export function leaveBehindClearsMadangdMigrationBlockers(
  store: MadangdMigrationPreflightStore & Pick<Store, 'createMadangdMigrationLeaveBehindView'>,
  targetId: string,
  bridgedPtyIds: readonly string[] = [],
  isBridgedPaneLease?: MadangdMigrationPaneLeasePredicate
): boolean {
  const view = store.createMadangdMigrationLeaveBehindView(targetId)
  const preflight = preflightMadangdMigrationExport(
    {
      ...view,
      getSshTarget: (id) => store.getSshTarget(id),
      getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id)
    },
    targetId,
    undefined,
    bridgedPtyIds
  )
  const target = store.getSshTarget(targetId)
  return (
    preflight.claimable &&
    target !== undefined &&
    preservesMadangdMigrationBridgedPanes(
      createMadangdMigrationManifest(view, target).payload,
      store.getSshRemotePtyLeases(targetId),
      bridgedPtyIds,
      isBridgedPaneLease
    )
  )
}

/** Only saved state blocks: a confirmed "Move anyway" may leave it on this desktop. */
export function onlyLeavableMadangdMigrationBlockers(
  blockers: readonly MadangdMigrationBlocker[]
): boolean {
  const blocking = blockers.filter(isBlockingMadangdMigrationBlocker)
  return (
    blocking.length > 0 &&
    blocking.every((blocker) => blocker.code === 'madangd_migration_dependent_state')
  )
}

export function isBlockingMadangdMigrationBlocker(blocker: MadangdMigrationBlocker): boolean {
  return (
    blocker.category !== 'drainable-static-state' &&
    blocker.code !== 'madangd_migration_saved_port_forwards'
  )
}
