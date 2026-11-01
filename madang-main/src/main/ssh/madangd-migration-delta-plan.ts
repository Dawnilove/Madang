/** Subtract earlier migrations' currently retained rows/state; export only additions. Never merge overlapping old source copies over server-owned state. */
import type { MadangdDeltaMovePreview, MadangdDeltaMoveRow } from '../../shared/madangd-managed-runtime'
import type {
  MadangdMigrationCatalogPayload,
  MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'
import { isRetainedMadangdMigrationSourceCutover } from '../../shared/madangd-migration/madangd-migration-source-cutover'
import type { MadangdMigrationSourceCutover } from '../../shared/madangd-migration/madangd-migration-source-cutover'
import type { SshTarget } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import { collectMadangdMigrationSourceCatalog } from '../persistence/migrating-madangd-catalog/madangd-source-catalog'
import { listMadangdMigrationCutoverChainForTarget } from './madangd-migration-cutover-journal'
import {
  createMadangdMigrationManifest,
  madangdMigrationCatalogIds,
  type MadangdMigrationCatalogIds
} from './madangd-migration-manifest-export'
import type { MadangdMigrationSnapshotSource } from './madangd-migration-snapshot-coordinator'
import { collectUntransferredDependentBlockers } from './targets/ssh-target-madangd-dependents'
import type { MadangdMigrationPreflightStore } from './targets/ssh-target-madangd-preflight'

export type MadangdDeltaSourceStore = MadangdMigrationPreflightStore & MadangdMigrationSnapshotSource

export function unfinishedMadangdDelta(
  chain: readonly MadangdMigrationSourceCutover[]
): MadangdMigrationSourceCutover | null {
  const head = chain.at(-1)
  return head?.supersedesMigrationId &&
    head.phase !== 'source-retired' &&
    !isRetainedMadangdMigrationSourceCutover(head)
    ? head
    : null
}

export function committedMadangdMigrationChain(
  chain: readonly MadangdMigrationSourceCutover[]
): MadangdMigrationSourceCutover[] {
  return (unfinishedMadangdDelta(chain) ? chain.slice(0, -1) : chain).filter(
    (cutover) => cutover.phase === 'destination-committed' || cutover.phase === 'source-retired'
  )
}

export function madangdDeltaSourceStore(
  store: Store,
  target: SshTarget,
  moved: readonly MadangdMigrationSourceCutover[],
  /** Older interrupted deltas may still include server-owned groups. */
  journaled?: MadangdMigrationManifest
): MadangdDeltaSourceStore {
  const ids = madangdMigrationCatalogIds(moved.map((cutover) => cutover.manifest.payload))
  // Never move projects/groups already owned through earlier links.
  const linked = moved.flatMap((cutover) => cutover.linkedRepositoryIds ?? [])
  const linkedGroups = moved.flatMap((cutover) => cutover.linkedProjectGroupIds ?? [])
  const linkedFolders = moved.flatMap((cutover) => cutover.linkedFolderWorkspaceIds ?? [])
  // New rows reference server-owned groups; exporting retained copies could overwrite newer server edits.
  const serverGroups = new Set([...ids.projectGroupIds, ...linkedGroups])
  const exported = new Set(journaled?.payload.projectGroups.map((group) => group.id))
  return madangdSourceStoreWithout(
    store,
    target,
    {
      ...ids,
      repositoryIds: new Set([...ids.repositoryIds, ...linked]),
      folderWorkspaceIds: new Set([...ids.folderWorkspaceIds, ...linkedFolders]),
      projectGroupIds: serverGroups
    },
    moved.at(-1)?.destinationEnvironmentId,
    new Set([...serverGroups].filter((id) => !exported.has(id)))
  )
}

export function madangdSourceStoreWithout(
  store: Store,
  target: SshTarget,
  owned: MadangdMigrationCatalogIds,
  destinationEnvironmentId: string | undefined,
  /** Groups the server's record wins for: never exported, even while a moving row sits in one. */
  serverGroupIds: ReadonlySet<string> = new Set()
): MadangdDeltaSourceStore {
  const ownedNow = createMadangdMigrationManifest(store, target, {
    destinationEnvironmentId,
    onlyCatalog: owned
  })
  const view = store.createMadangdMigrationDeltaView(ownedNow)
  return {
    ...view,
    serverOwnedProjectGroupIds: serverGroupIds,
    getSshTarget: (id) => store.getSshTarget(id),
    getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id),
    readMadangdMigrationSourceSnapshotChunk: (...args) =>
      store.readMadangdMigrationSourceSnapshotChunk(...args)
  }
}

export type MadangdDeltaMovePlan = MadangdDeltaMovePreview & {
  manifest: MadangdMigrationManifest
  moved: MadangdMigrationSourceCutover[]
  head: MadangdMigrationSourceCutover
  resumes: MadangdMigrationSourceCutover | null
  source: MadangdDeltaSourceStore
}

export function planMadangdDeltaMove(
  userDataPath: string,
  store: Store,
  target: SshTarget,
  options: { migrationId?: string; now?: () => Date } = {}
): MadangdDeltaMovePlan {
  const environmentId = target.madangdFence?.environmentId
  if (!environmentId || !target.madangdFence?.sourceChangedAt) {
    throw new Error('madangd_delta_not_changed')
  }
  const chain = listMadangdMigrationCutoverChainForTarget(userDataPath, target.id)
  const resumes = unfinishedMadangdDelta(chain)
  const moved = committedMadangdMigrationChain(chain)
  const head = chain.at(resumes ? -2 : -1)
  if (
    !head ||
    !isRetainedMadangdMigrationSourceCutover(head) ||
    moved.at(-1)?.migrationId !== head.migrationId
  ) {
    throw new Error('madangd_delta_no_retained_migration')
  }
  const source = madangdDeltaSourceStore(store, target, moved, resumes?.manifest)
  const manifest =
    resumes?.manifest ??
    createMadangdMigrationManifest(source, target, {
      migrationId: options.migrationId,
      now: options.now,
      destinationEnvironmentId: environmentId
    })
  const current = collectMadangdMigrationSourceCatalog(store, target)
  return {
    sshTargetId: target.id,
    environmentId,
    added: catalogRows(manifest.payload),
    notReflected: notReflected(
      current,
      moved.map((cutover) => cutover.manifest.payload)
    ),
    blockers: collectUntransferredDependentBlockers(source, manifest),
    manifest,
    moved,
    head,
    resumes,
    source
  }
}

function catalogRows(catalog: MadangdMigrationCatalogPayload): MadangdDeltaMoveRow[] {
  return [
    ...catalog.repositories.map((row) => ({
      kind: 'repository' as const,
      id: row.id,
      label: row.displayName
    })),
    ...catalog.folderWorkspaces.map((row) => ({
      kind: 'folder-workspace' as const,
      id: row.id,
      label: row.name
    })),
    ...catalog.projectGroups.map((row) => ({
      kind: 'project-group' as const,
      id: row.id,
      label: row.name
    }))
  ]
}

/** Rows earlier migrations moved that an older build has since changed or removed. */
function notReflected(
  current: MadangdMigrationCatalogPayload,
  movedPayloads: readonly MadangdMigrationCatalogPayload[]
): MadangdDeltaMovePreview['notReflected'] {
  const latestMoved = new Map<string, { row: MadangdDeltaMoveRow; identity: string }>()
  for (const payload of movedPayloads) {
    for (const row of catalogRows(payload)) {
      latestMoved.set(`${row.kind}:${row.id}`, { row, identity: identityOf(payload, row) })
    }
  }
  const currentByKey = new Map(
    catalogRows(current).map((row) => [`${row.kind}:${row.id}`, identityOf(current, row)])
  )
  const edited: MadangdDeltaMoveRow[] = []
  const removed: MadangdDeltaMoveRow[] = []
  for (const [key, moved] of latestMoved) {
    const identity = currentByKey.get(key)
    if (identity === undefined) {
      removed.push(moved.row)
    } else if (identity !== moved.identity) {
      edited.push(moved.row)
    }
  }
  return { edited, removed }
}

function identityOf(catalog: MadangdMigrationCatalogPayload, row: MadangdDeltaMoveRow): string {
  switch (row.kind) {
    case 'repository': {
      const repo = catalog.repositories.find((entry) => entry.id === row.id)
      return `${repo?.path}\0${repo?.displayName}`
    }
    case 'folder-workspace': {
      const folder = catalog.folderWorkspaces.find((entry) => entry.id === row.id)
      return `${folder?.folderPath}\0${folder?.name}`
    }
    case 'project-group':
      return catalog.projectGroups.find((entry) => entry.id === row.id)?.name ?? ''
  }
}
