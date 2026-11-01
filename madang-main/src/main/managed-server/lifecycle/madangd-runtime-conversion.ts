// Resume journaled migrations after lost contact; source rows stay authoritative until proven commit.
// Retain source rows afterwards for downgrade compatibility.
import { randomUUID } from 'node:crypto'
import type { MadangdManagedConversionResult } from '../../../shared/madangd-managed-runtime'
import type { MadangdMigrationSourceCutover } from '../../../shared/madangd-migration/madangd-migration-source-cutover'
import { recordManagedMadangdMigration } from '../../../shared/runtime-environment-managed-madangd-store'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import {
  getMadangdSshDeployment,
  redactRuntimeEnvironment,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { environmentMatchesManagedMadangdCutover } from './madangd-managed-migration-status'
import { requireManagedMadangdInfrastructure } from './madangd-managed-runtime-context'
import { ensureMadangdManagedTunnel } from './madangd-managed-tunnel'
import {
  commitMadangdMigrationDestination,
  type MadangdMigrationDestinationCatalog
} from '../../ssh/madangd-migration-cutover-coordinator'
import {
  findMadangdMigrationSourceCutoverForTarget,
  removeMadangdMigrationJournalsForDestination
} from '../../ssh/madangd-migration-cutover-journal'
import type { SshTarget } from '../../../shared/ssh-types'
import type { CensusHostRelayTerminals } from '../../ssh/madangd-migration-terminal-gate'
import { createManagedMadangdEnvironment } from './madangd-runtime-deployment'
import { createSshRelayMigrationSource } from '../../ssh/madangd-migration-ssh-relay-source'
import {
  leaveBehindClearsMadangdMigrationBlockers,
  onlyLeavableMadangdMigrationBlockers
} from '../../ssh/targets/ssh-target-madangd-preflight'
import { MADANGD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON } from '../../ssh/madangd-migration-source-fence'
import type { MadangdMigrationPaneLeasePredicate } from '../../ssh/madangd-migration-bridged-panes'
import { retainMadangdMigrationSource } from '../../ssh/madangd-migration-source-retention'
import {
  linkedMadangdMigrationCutoverPort,
  linkedMadangdMigrationProjects,
  linkServerHeldRepositories,
  type MadangdServerRepository
} from '../../ssh/madangd-migration-repository-link'
import type { MadangdServerFolderCatalog } from '../../ssh/madangd-server-folder-workspaces'

export type MadangdManagedConversionArgs = {
  sshTargetId: string
  name: string
  censusHost?: ((target: SshTarget) => ReturnType<CensusHostRelayTerminals>) | null
  isBridgedPaneLease?: MadangdMigrationPaneLeasePredicate
  destinationFor: (environment: KnownRuntimeEnvironment) => MadangdMigrationDestinationCatalog
  /** Link matching host paths to existing server projects. */
  serverRepositoriesFor?: (environment: KnownRuntimeEnvironment) => Promise<MadangdServerRepository[]>
  /** Link folder workspaces already present from earlier moves. */
  serverFolderCatalogFor?: (
    environment: KnownRuntimeEnvironment
  ) => Promise<MadangdServerFolderCatalog>
  releaseDirectSession?: (sshTargetId: string) => Promise<void>
  now?: () => Date
  signal?: AbortSignal
}

export async function convertSshTargetToManagedMadangd(
  userDataPath: string,
  args: MadangdManagedConversionArgs
): Promise<MadangdManagedConversionResult> {
  const fenced = await fenceOrResume(userDataPath, args)
  if ('outcome' in fenced) {
    return fenced
  }
  const deployed = await createManagedMadangdEnvironment(userDataPath, {
    name: fenced.destinationName,
    sshTargetId: fenced.sshTargetId,
    migration: true,
    signal: args.signal
  })
  if (deployed.outcome === 'deferred') {
    return deployed // Retain fence and journal for a later resume.
  }
  const environment = listEnvironments(userDataPath).find(
    (entry) => entry.id === fenced.destinationEnvironmentId
  )
  if (!environment || !environmentMatchesManagedMadangdCutover(environment, fenced)) {
    throw new Error('madangd_migration_destination_environment_mismatch')
  }
  // Record before commit so crashes cannot allow rollback across migrated state.
  recordManagedMadangdMigration(
    userDataPath,
    environment.id,
    (args.now ?? (() => new Date()))().toISOString()
  )
  // Tunnel repair may replace pairing credentials; use its returned environment for every request.
  const marked = await ensureMadangdManagedTunnel(userDataPath, environment.id)
  const { claims, targetStore } = requireManagedMadangdInfrastructure()
  const store = targetStore.getMadangdMigrationSource()
  const destination = args.destinationFor(marked)
  const serverRepositoriesFor = args.serverRepositoriesFor
  const serverFolderCatalogFor = args.serverFolderCatalogFor
  let linked: Pick<
    MadangdMigrationSourceCutover,
    'linkedRepositoryIds' | 'linkedFolderWorkspaceIds'
  > = {}
  const committed = await runTargetLifecycle(fenced.sshTargetId, async () => {
    const journaled = requireJournaledCutover(userDataPath, fenced)
    const cutover = serverRepositoriesFor
      ? await linkServerHeldRepositories({
          userDataPath,
          store,
          claims,
          cutover: journaled,
          destination,
          serverRepositories: () => serverRepositoriesFor(marked),
          ...(serverFolderCatalogFor
            ? { serverFolderCatalog: () => serverFolderCatalogFor(marked) }
            : {}),
          now: args.now
        })
      : journaled
    linked = cutover
    return commitMadangdMigrationDestination(
      {
        userDataPath,
        store,
        claims,
        source: linkedMadangdMigrationCutoverPort({ userDataPath, store, claims, cutover }),
        destination,
        now: args.now
      },
      cutover.migrationId
    )
  })
  if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
    throw new Error(`madangd_migration_commit_not_proven:${committed.phase}`)
  }
  if (committed.phase === 'destination-committed') {
    await retainMadangdMigrationSource(userDataPath, committed.migrationId, store, args.now)
  }
  const linkedProjects = linkedMadangdMigrationProjects(store, linked)
  return {
    outcome: 'converted',
    environment: redactRuntimeEnvironment(marked),
    migrationId: committed.migrationId,
    ...(linkedProjects.length > 0 ? { linkedProjects } : {})
  }
}

async function fenceOrResume(
  userDataPath: string,
  args: MadangdManagedConversionArgs
): Promise<
  MadangdMigrationSourceCutover | Extract<MadangdManagedConversionResult, { outcome: 'refused' }>
> {
  const { claims, targetStore } = requireManagedMadangdInfrastructure()
  const target = targetStore.getTarget(args.sshTargetId)
  if (!target) {
    return refuse('unverifiable', 'madangd_migration_target_not_found', 'The SSH host is gone.')
  }
  const store = targetStore.getMadangdMigrationSource()
  const censusHost = args.censusHost
  const source = createSshRelayMigrationSource({
    userDataPath,
    store,
    claims,
    target,
    censusHost: censusHost ? () => censusHost(target) : null,
    isBridgedPaneLease: args.isBridgedPaneLease
  })
  const existing = source.resolveFence()
  if (existing.state === 'fenced') {
    return existing.cutover
  }
  const stale = existing.state === 'stale-journal' ? existing.cutover : null
  if (stale && !isRegistered(userDataPath, stale.destinationEnvironmentId)) {
    removeMadangdMigrationJournalsForDestination(
      userDataPath,
      target.id,
      stale.destinationEnvironmentId
    )
  }
  const converted = listEnvironments(userDataPath).some(
    (environment) => getMadangdSshDeployment(environment)?.sshTargetId === target.id
  )
  if (converted) {
    return refuse(
      'live',
      'madangd_migration_already_managed',
      'Madang already runs on this SSH host.'
    )
  }
  // Source fencing rechecks leases after acquisition.
  const terminalProof = await source.assessTerminals()
  if (terminalProof.verdict === 'live' || terminalProof.verdict === 'unverifiable') {
    return refuse(terminalProof.verdict, 'madangd_migration_terminals', terminalProof.reason)
  }
  source.retireProvenExitedTerminals(terminalProof)
  await args.releaseDirectSession?.(target.id)
  const result = await runTargetLifecycle(target.id, () =>
    source.acquireFence({
      destinationEnvironmentId: randomUUID(),
      destinationName: args.name,
      terminalProof,
      now: args.now,
      signal: args.signal
    })
  )
  if (result.outcome === 'fenced') {
    return result.cutover
  }
  if (result.blockers?.length) {
    // Surface blocked state in logs because connect shows only the summary reason.
    console.warn(
      '[ssh] Conversion refused by:',
      JSON.stringify(
        result.blockers.map((blocker) =>
          'dependencies' in blocker
            ? { code: blocker.code, dependencies: blocker.dependencies }
            : { code: blocker.code }
        )
      )
    )
  }
  const leavable =
    result.blockers &&
    onlyLeavableMadangdMigrationBlockers(result.blockers) &&
    !target.managedServerLeaveBehind
  const canLeaveBehind =
    leavable &&
    leaveBehindClearsMadangdMigrationBlockers(
      store,
      target.id,
      terminalProof.verdict === 'bridged' ? terminalProof.bridgedPtyIds : [],
      args.isBridgedPaneLease
    )
  if (leavable && terminalProof.verdict !== 'exited' && !canLeaveBehind) {
    // Leaving tabs behind would strand terminals still served by the legacy bridge.
    return refuse(
      result.verdict,
      result.code,
      `${result.reason} ${MADANGD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON}`
    )
  }
  return {
    ...refuse(result.verdict, result.code, result.reason),
    // Preview confirmation to avoid offering an export the confirmed path would refuse.
    ...(canLeaveBehind ? { canLeaveBehind: true } : {})
  }
}

function requireJournaledCutover(
  userDataPath: string,
  fenced: MadangdMigrationSourceCutover
): MadangdMigrationSourceCutover {
  const journaled = findMadangdMigrationSourceCutoverForTarget(userDataPath, fenced.sshTargetId)
  if (journaled?.migrationId !== fenced.migrationId) {
    throw new Error('madangd_migration_source_fence_lost')
  }
  return journaled
}

function isRegistered(userDataPath: string, environmentId: string): boolean {
  return listEnvironments(userDataPath).some((environment) => environment.id === environmentId)
}

function refuse(
  verdict: 'live' | 'unverifiable',
  code: string,
  reason: string
): Extract<MadangdManagedConversionResult, { outcome: 'refused' }> {
  return { outcome: 'refused', verdict, code, reason }
}
