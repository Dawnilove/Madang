/** Journal only additions made after conversion to the same server; retain the full journal chain and source rows. Stage conflicts leave the changed mark and source intact; uncertain outcomes keep the journal for resume. */
import {
  MADANGD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type MadangdMigrationSourceCutover
} from '../../shared/madangd-migration/madangd-migration-source-cutover'
import type { MadangdDeltaMoveResult } from '../../shared/madangd-managed-runtime'
import { recordManagedMadangdMigration } from '../../shared/runtime-environment-managed-madangd-store'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type { SshTarget } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import {
  abortMadangdMigrationCutover,
  commitMadangdMigrationDestination,
  type MadangdMigrationCutoverContext,
  type MadangdMigrationDestinationCatalog
} from './madangd-migration-cutover-coordinator'
import {
  findMadangdMigrationSourceCutoverForTarget,
  listMadangdMigrationCutoverChainForTarget,
  removeMadangdMigrationSourceCutover,
  writeMadangdMigrationSourceCutover
} from './madangd-migration-cutover-journal'
import {
  committedMadangdMigrationChain,
  madangdDeltaSourceStore,
  planMadangdDeltaMove,
  unfinishedMadangdDelta,
  type MadangdDeltaMovePlan
} from './madangd-migration-delta-plan'
import { assertMadangdMigrationRequestFits } from './madangd-migration-manifest-export'
import { retainMadangdMigrationSource } from './madangd-migration-source-retention'
import {
  assessMadangdMigrationTerminals,
  type MadangdMigrationTerminalVerdict,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './madangd-migration-terminal-gate'
import {
  currentMadangdSourceFingerprint,
  madangdCatalogFingerprint,
  unmovedMadangdSourceRows,
  withKeptMadangdSourceRows
} from './madangd-retained-source'
import { collectMadangdMigrationSourceCatalog } from '../persistence/migrating-madangd-catalog/madangd-source-catalog'
import type { SshTargetMadangdClaims } from './targets/ssh-target-madangd-claims'
import { madangdMigrationRefusalReason } from './madangd-migration-refusal-reason'
import { errorMessage } from '../../shared/error-message'

type MadangdDeltaMoveArgs = {
  userDataPath: string
  store: Store
  claims: SshTargetMadangdClaims
  target: SshTarget
  environment: KnownRuntimeEnvironment
  /** Build the destination after opening its tunnel: re-pairing during open can replace commit credentials. */
  connectDestination: () => Promise<MadangdMigrationDestinationCatalog>
  /** Host census proves exit or identifies terminals preserved by the legacy bridge. */
  censusHost?: CensusHostRelayTerminals | null
  /** Serialize journal-through-commit with all other lifecycle changes to this host. */
  runTargetLifecycle: <T>(targetId: string, operation: () => Promise<T>) => Promise<T>
  now?: () => Date
}

export async function runMadangdDeltaMove(args: MadangdDeltaMoveArgs): Promise<MadangdDeltaMoveResult> {
  const { userDataPath, store, target } = args
  const now = args.now ?? (() => new Date())
  const plan = planMadangdDeltaMove(userDataPath, store, target, { now })
  // Capture baseline with the manifest before awaiting so both describe the same source.
  const planned = currentMadangdSourceFingerprint(store, target)
  if (!plan.resumes && plan.added.length === 0) {
    return refuse('madangd_delta_nothing_new', 'An older build added nothing new to move.')
  }
  if (plan.blockers.length > 0) {
    return {
      ...refuse('madangd_migration_preflight_blocked', madangdMigrationRefusalReason(plan.blockers)),
      blockers: plan.blockers
    }
  }
  if (!plan.resumes) {
    // Reject before journaling or an unsendable delta could pin the fence permanently.
    assertMadangdMigrationRequestFits({ manifest: plan.manifest })
  }
  const terminals = await assessMadangdMigrationTerminals(store, target.id, args.censusHost)
  if (terminals.verdict !== 'exited' && terminals.verdict !== 'bridged') {
    return refuse('madangd_migration_terminals', terminals.reason)
  }
  const settled: SettledTerminals = terminals
  retireProvenExitedLeases(store, target.id, terminals)
  return args.runTargetLifecycle(target.id, async () => {
    // Another move may have journaled or finished while waiting for the lifecycle lock.
    const changedAt = store.getSshTarget(target.id)?.madangdFence?.sourceChangedAt
    const head = findMadangdMigrationSourceCutoverForTarget(userDataPath, target.id)
    if (!changedAt || head?.migrationId !== (plan.resumes ?? plan.head).migrationId) {
      return refuse('madangd_delta_superseded', 'Another move of this host ran first.')
    }
    // Source remains writable before fencing; edits during census must not silently become the manifest's baseline.
    if (!plan.resumes && planned !== currentMadangdSourceFingerprint(store, target)) {
      return refuse(
        'madangd_delta_source_changed',
        'This host changed while the move was starting. Try the move again.'
      )
    }
    const cutover = plan.resumes ?? journalDelta(args, plan, planned, settled, now)
    return commitDelta(args, plan, cutover, changedAt, now)
  })
}

type SettledTerminals = Extract<MadangdMigrationTerminalVerdict, { verdict: 'exited' | 'bridged' }>

function journalDelta(
  args: MadangdDeltaMoveArgs,
  plan: MadangdDeltaMovePlan,
  planned: string,
  terminals: SettledTerminals,
  now: () => Date
): MadangdMigrationSourceCutover {
  const timestamp = now().toISOString()
  const cutover: MadangdMigrationSourceCutover = {
    version: MADANGD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: plan.manifest.migrationId,
    phase: 'source-fenced',
    startedAt: timestamp,
    updatedAt: timestamp,
    destinationEnvironmentId: plan.environmentId,
    destinationName: plan.head.destinationName,
    sshTargetId: args.target.id,
    sshTargetGeneration: plan.head.sshTargetGeneration,
    manifestSha256: plan.manifest.manifestSha256,
    provenPtyIds: terminals.verdict === 'exited' ? terminals.provenPtyIds : [],
    // COMPAT(legacy-relay-bridge): a move leaves relay terminals running for the bridge too.
    ...(terminals.verdict === 'bridged' ? { bridgedPtyIds: terminals.bridgedPtyIds } : {}),
    supersedesMigrationId: plan.head.migrationId,
    // Retained rows must match the whole source captured with this manifest.
    sourceBaselineFingerprint: planned,
    manifest: plan.manifest
  }
  writeMadangdMigrationSourceCutover(args.userDataPath, cutover)
  return cutover
}

async function commitDelta(
  args: MadangdDeltaMoveArgs,
  plan: MadangdDeltaMovePlan,
  cutover: MadangdMigrationSourceCutover,
  changedAt: string,
  now: () => Date
): Promise<MadangdDeltaMoveResult> {
  const { userDataPath, store, target } = args
  // Clear the changed mark and freeze source for the move.
  store.updateSshTarget(target.id, { madangdFence: { environmentId: plan.environmentId } })
  await args.claims.flush()
  // Record before any new/resumed commit so rollback cannot cross the migration.
  recordManagedMadangdMigration(userDataPath, plan.environmentId, now().toISOString())
  let destination: MadangdMigrationDestinationCatalog
  try {
    destination = await args.connectDestination()
  } catch (error) {
    // No request reached the server; keep the journal for later resume.
    await restoreChangedMark(args, cutover, changedAt)
    throw error
  }
  const context: MadangdMigrationCutoverContext = {
    userDataPath,
    store: plan.source,
    freshSource: () => madangdDeltaSourceStore(store, target, plan.moved, cutover.manifest),
    claims: args.claims,
    destination,
    now
  }
  try {
    const committed = await commitMadangdMigrationDestination(context, cutover.migrationId)
    if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
      throw new Error(`madangd_migration_commit_not_proven:${committed.phase}`)
    }
  } catch (error) {
    const released = await releaseUncommittedDelta(args, context, cutover, changedAt)
    if (released === 'released') {
      return refuse('madangd_delta_refused_by_server', errorMessage(error))
    }
    if (released === 'kept') {
      throw error
    }
  }
  await retainMadangdMigrationSource(userDataPath, cutover.migrationId, store, now)
  return { outcome: 'moved', migrationId: cutover.migrationId }
}

/** Release only on proven destination absence; otherwise retain journal for resume. Restore the host's changed mark either way. */
async function releaseUncommittedDelta(
  args: MadangdDeltaMoveArgs,
  context: MadangdMigrationCutoverContext,
  cutover: MadangdMigrationSourceCutover,
  changedAt: string
): Promise<'released' | 'committed' | 'kept'> {
  const restoreMark = (): Promise<void> => restoreChangedMark(args, cutover, changedAt)
  try {
    const result = await abortMadangdMigrationCutover(context, cutover.migrationId, async () => {
      // Restore the mark first so a crash during journal removal leaves a resumable marked host.
      await restoreMark()
      removeMadangdMigrationSourceCutover(args.userDataPath, cutover.migrationId)
    })
    return result.outcome === 'released' ? 'released' : 'committed'
  } catch {
    await restoreMark()
    return 'kept'
  }
}

async function restoreChangedMark(
  args: Pick<MadangdDeltaMoveArgs, 'store' | 'claims'>,
  cutover: MadangdMigrationSourceCutover,
  changedAt: string
): Promise<void> {
  args.store.updateSshTarget(cutover.sshTargetId, {
    madangdFence: { environmentId: cutover.destinationEnvironmentId, sourceChangedAt: changedAt }
  })
  await args.claims.flush()
}

/** Keep older-build changes only in retained profile rows. */
export async function keepMadangdServerVersion(args: {
  userDataPath: string
  store: Store
  claims: SshTargetMadangdClaims
  target: SshTarget
}): Promise<void> {
  const environmentId = args.target.madangdFence?.environmentId
  const chain = listMadangdMigrationCutoverChainForTarget(args.userDataPath, args.target.id)
  if (unfinishedMadangdDelta(chain)) {
    // Unfinished moves may already have copied rows; only commit/abort can decide.
    throw new Error('madangd_delta_move_unfinished')
  }
  const head = committedMadangdMigrationChain(chain).at(-1)
  if (!environmentId || !args.target.madangdFence?.sourceChangedAt || !head) {
    throw new Error('madangd_delta_not_changed')
  }
  const current = collectMadangdMigrationSourceCatalog(args.store, args.target)
  const unmoved = unmovedMadangdSourceRows(current, committedMadangdMigrationChain(chain))
  writeMadangdMigrationSourceCutover(args.userDataPath, {
    ...withKeptMadangdSourceRows(head, unmoved),
    // Explicit reconcile accepts the current retained source as the new baseline.
    sourceBaselineFingerprint: madangdCatalogFingerprint(current)
  })
  args.store.updateSshTarget(args.target.id, { madangdFence: { environmentId } })
  await args.claims.flush()
}

function refuse(
  code: string,
  reason: string
): Extract<MadangdDeltaMoveResult, { outcome: 'refused' }> {
  return { outcome: 'refused', code, reason }
}
