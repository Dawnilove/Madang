/** Persist journal, fence, then profile flush before remote calls. Crashes may leave a non-authoritative stale journal; a fence without a journal requires destination evidence before release. */
import { randomUUID } from 'node:crypto'
import { getManagedMadangdFenceEnvironmentId } from '../../shared/managed-madangd-ssh-owner'
import type { MadangdMigrationBlocker } from '../../shared/madangd-migration/madangd-migration-preflight'
import {
  MADANGD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type MadangdMigrationSourceCutover
} from '../../shared/madangd-migration/madangd-migration-source-cutover'
import type { SshTarget } from '../../shared/ssh-types'
import {
  assertMadangdMigrationRequestFits,
  createMadangdMigrationManifest
} from './madangd-migration-manifest-export'
import {
  findMadangdMigrationSourceCutoverForTarget,
  removeMadangdMigrationSourceCutover,
  writeMadangdMigrationSourceCutover
} from './madangd-migration-cutover-journal'
import {
  confirmMadangdMigrationTerminalsUnderFence,
  type MadangdMigrationTerminalVerdict
} from './madangd-migration-terminal-gate'
import type { SshTargetMadangdClaims } from './targets/ssh-target-madangd-claims'
import {
  isBlockingMadangdMigrationBlocker,
  preflightMadangdMigrationExport,
  type MadangdMigrationPreflightStore
} from './targets/ssh-target-madangd-preflight'
import { madangdMigrationRefusalReason } from './madangd-migration-refusal-reason'
import {
  preservesMadangdMigrationBridgedPanes,
  type MadangdMigrationPaneLeasePredicate
} from './madangd-migration-bridged-panes'

export const MADANGD_MIGRATION_LEAVE_BEHIND_TERMINALS = 'madangd_migration_leave_behind_terminals'
export const MADANGD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON =
  'Move anyway needs every terminal on this host closed first, and Madang could not confirm they all exited. Close them, or end them on the host, then connect again.'

export type MadangdMigrationFenceState =
  | { state: 'none' }
  | { state: 'fenced'; cutover: MadangdMigrationSourceCutover }
  /** Empty-host deploys record provisioning intent instead of a migration journal. */
  | { state: 'owned-by-deploy'; environmentId: string }
  /** Unexplained ownership requires recovery, never automatic release. */
  | { state: 'fenced-unverifiable'; environmentId: string }
  /** Stale journals grant no staging authority. */
  | { state: 'stale-journal'; cutover: MadangdMigrationSourceCutover }

/** Throws when the journal cannot be read: an unreadable record keeps the host fenced. */
export function resolveMadangdMigrationFence(
  userDataPath: string,
  target: SshTarget
): MadangdMigrationFenceState {
  const cutover = findMadangdMigrationSourceCutoverForTarget(userDataPath, target.id)
  const ownerEnvironmentId = getManagedMadangdFenceEnvironmentId(target)
  if (cutover) {
    return ownerEnvironmentId === cutover.destinationEnvironmentId &&
      target.generation === cutover.sshTargetGeneration
      ? { state: 'fenced', cutover }
      : { state: 'stale-journal', cutover }
  }
  if (!ownerEnvironmentId) {
    return { state: 'none' }
  }
  return target.madangdProvisioning
    ? { state: 'owned-by-deploy', environmentId: ownerEnvironmentId }
    : { state: 'fenced-unverifiable', environmentId: ownerEnvironmentId }
}

export type MadangdMigrationFenceResult =
  | { outcome: 'fenced'; cutover: MadangdMigrationSourceCutover; resumed: boolean }
  | {
      outcome: 'refused'
      verdict: 'live' | 'unverifiable'
      code: string
      reason: string
      blockers?: MadangdMigrationBlocker[]
    }

export async function fenceMadangdMigrationSource(args: {
  userDataPath: string
  store: MadangdMigrationPreflightStore
  claims: SshTargetMadangdClaims
  targetId: string
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: MadangdMigrationTerminalVerdict
  isBridgedPaneLease?: MadangdMigrationPaneLeasePredicate
  now?: () => Date
  signal?: AbortSignal
}): Promise<MadangdMigrationFenceResult> {
  const target = args.store.getSshTarget(args.targetId)
  if (!target) {
    return refuse('unverifiable', 'madangd_migration_target_not_found', 'The SSH host is gone.')
  }
  const existing = resolveMadangdMigrationFence(args.userDataPath, target)
  if (existing.state === 'fenced') {
    return existing.cutover.destinationEnvironmentId === args.destinationEnvironmentId
      ? { outcome: 'fenced', cutover: existing.cutover, resumed: true }
      : refuse('live', 'madangd_migration_in_progress', 'Another migration holds this SSH host.')
  }
  if (existing.state !== 'none') {
    return refuse(
      'unverifiable',
      `madangd_migration_${existing.state.replaceAll('-', '_')}`,
      fenceStateReason(existing)
    )
  }
  const proof = args.terminalProof
  if (proof.verdict !== 'exited' && proof.verdict !== 'bridged') {
    return refuse(proof.verdict, 'madangd_migration_terminals', proof.reason)
  }
  const preflight = preflightMadangdMigrationExport(
    args.store,
    target.id,
    undefined,
    proof.verdict === 'bridged' ? proof.bridgedPtyIds : []
  )
  if (!preflight.claimable) {
    return {
      ...refuse(
        // Only a proven blocker reads live; one that is merely unanswered stays unverifiable.
        preflight.blockers
          .filter(isBlockingMadangdMigrationBlocker)
          .every((blocker) => blocker.category === 'live-or-unverifiable')
          ? 'unverifiable'
          : 'live',
        'madangd_migration_preflight_blocked',
        madangdMigrationRefusalReason(preflight.blockers)
      ),
      blockers: preflight.blockers
    }
  }
  const generation = args.claims.ensureGeneration(target.id)
  const now = (args.now ?? (() => new Date()))().toISOString()
  const manifest = createMadangdMigrationManifest(
    args.store,
    { ...target, generation },
    { migrationId: randomUUID(), destinationEnvironmentId: args.destinationEnvironmentId }
  )
  if (
    proof.verdict === 'bridged' &&
    target.managedServerLeaveBehind &&
    !preservesMadangdMigrationBridgedPanes(
      manifest.payload,
      args.store.getSshRemotePtyLeases(target.id),
      proof.bridgedPtyIds,
      args.isBridgedPaneLease
    )
  ) {
    return refuse(
      proof.relayVerdict,
      MADANGD_MIGRATION_LEAVE_BEHIND_TERMINALS,
      MADANGD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON
    )
  }
  // Reject before journaling so an unsendable manifest cannot pin the fence.
  assertMadangdMigrationRequestFits({ manifest })
  const cutover: MadangdMigrationSourceCutover = {
    version: MADANGD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: manifest.migrationId,
    phase: 'source-fenced',
    startedAt: now,
    updatedAt: now,
    destinationEnvironmentId: args.destinationEnvironmentId,
    destinationName: args.destinationName,
    sshTargetId: target.id,
    sshTargetGeneration: generation,
    manifestSha256: manifest.manifestSha256,
    provenPtyIds: proof.verdict === 'exited' ? proof.provenPtyIds : [],
    ...(proof.verdict === 'bridged' ? { bridgedPtyIds: proof.bridgedPtyIds } : {}),
    // Capture before commit; this journaled export is the evidence of what the destination receives.
    manifest
  }
  writeMadangdMigrationSourceCutover(args.userDataPath, cutover)
  args.claims.fenceForMigration(target.id, args.destinationEnvironmentId, generation)
  await args.claims.flush(args.signal)
  // Recheck under fence for terminals started after the original proof.
  const underFence = confirmMadangdMigrationTerminalsUnderFence(
    args.store,
    target.id,
    args.terminalProof
  )
  if (underFence.verdict !== 'exited' && underFence.verdict !== 'bridged') {
    await releaseUnstagedFence(args, cutover)
    return refuse(underFence.verdict, 'madangd_migration_terminals', underFence.reason)
  }
  return { outcome: 'fenced', cutover, resumed: false }
}

type FenceReleaseArgs = { userDataPath: string; claims: SshTargetMadangdClaims; signal?: AbortSignal }

async function releaseUnstagedFence(
  args: FenceReleaseArgs,
  cutover: MadangdMigrationSourceCutover
): Promise<void> {
  if (cutover.phase !== 'source-fenced') {
    throw new Error('madangd_migration_fence_release_after_stage')
  }
  await releaseMadangdMigrationFence(args, cutover)
}

/** Drop owner before journal so an interrupted release leaves a harmless stale journal, never unexplained ownership. */
export async function releaseMadangdMigrationFence(
  args: FenceReleaseArgs,
  cutover: MadangdMigrationSourceCutover
): Promise<void> {
  args.claims.release(cutover.sshTargetId, cutover.destinationEnvironmentId)
  await args.claims.flush(args.signal)
  removeMadangdMigrationSourceCutover(args.userDataPath, cutover.migrationId)
}

/** Unregistered destinations could stage nothing; registered destinations must prove durable abort instead. */
export async function releaseUndeployedMigrationFence(args: {
  userDataPath: string
  claims: SshTargetMadangdClaims
  targetId: string
  isDestinationRegistered: (environmentId: string) => boolean
  signal?: AbortSignal
}): Promise<'released' | 'none'> {
  const cutover = findMadangdMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  if (!cutover) {
    return 'none'
  }
  if (args.isDestinationRegistered(cutover.destinationEnvironmentId)) {
    throw new Error('madangd_migration_destination_registered')
  }
  await releaseUnstagedFence(args, cutover)
  return 'released'
}

function fenceStateReason(state: MadangdMigrationFenceState): string {
  switch (state.state) {
    case 'owned-by-deploy':
      return 'Madang already runs on this SSH host.'
    case 'fenced-unverifiable':
      return 'This SSH host is held for a migration whose record is missing. Recover it from this host’s Madang server first.'
    case 'stale-journal':
      return 'A migration record names this SSH host but its fence is gone. Resolve that migration first.'
    case 'fenced':
    case 'none':
      return 'This SSH host is not in a state a migration can start from.'
  }
}

function refuse(
  verdict: 'live' | 'unverifiable',
  code: string,
  reason: string
): Extract<MadangdMigrationFenceResult, { outcome: 'refused' }> {
  return { outcome: 'refused', verdict, code, reason }
}
