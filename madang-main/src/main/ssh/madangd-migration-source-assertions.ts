import { createHash } from 'node:crypto'
import {
  serializeMadangdMigrationValue,
  type MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'
import type { MadangdMigrationSourceCutover } from '../../shared/madangd-migration/madangd-migration-source-cutover'
import { createMadangdMigrationManifest } from './madangd-migration-manifest-export'
import { resolveMadangdMigrationFence } from './madangd-migration-source-fence'
import { confirmMadangdMigrationTerminalsUnderFence } from './madangd-migration-terminal-gate'
import { collectUntransferredDependentBlockers } from './targets/ssh-target-madangd-dependents'
import type { MadangdMigrationPreflightStore } from './targets/ssh-target-madangd-preflight'

export function assertMadangdMigrationSourceUnchanged(
  context: { userDataPath: string; store: MadangdMigrationPreflightStore },
  cutover: MadangdMigrationSourceCutover
): void {
  const target = context.store.getSshTarget(cutover.sshTargetId)
  const fence = target ? resolveMadangdMigrationFence(context.userDataPath, target) : null
  if (!target || fence?.state !== 'fenced' || fence.cutover.migrationId !== cutover.migrationId) {
    throw new Error('madangd_migration_source_fence_lost')
  }
  // Re-export with journaled identity/time/destination so only source changes affect comparison.
  const current = createMadangdMigrationManifest(context.store, target, {
    migrationId: cutover.migrationId,
    destinationEnvironmentId: cutover.destinationEnvironmentId,
    now: () => new Date(cutover.manifest.createdAt)
  })
  if (frozenSourceDigest(current) !== frozenSourceDigest(cutover.manifest)) {
    throw new Error('madangd_migration_source_changed')
  }
  if (collectUntransferredDependentBlockers(context.store, cutover.manifest).length > 0) {
    throw new Error('madangd_migration_source_dependencies_present')
  }
  const terminals = confirmMadangdMigrationTerminalsUnderFence(
    context.store,
    target.id,
    cutover.bridgedPtyIds
      ? {
          verdict: 'bridged',
          relayVerdict: 'unverifiable',
          bridgedPtyIds: cutover.bridgedPtyIds,
          hostTerminals: 0
        }
      : { verdict: 'exited', provenPtyIds: cutover.provenPtyIds }
  )
  if (terminals.verdict === 'live' || terminals.verdict === 'unverifiable') {
    throw new Error(`madangd_migration_source_terminals_${terminals.verdict}`)
  }
}

/** Ignore mutable UI layout/focus/routing: the destination gets the journaled view, and tab churn must not invalidate migration. */
function frozenSourceDigest(manifest: MadangdMigrationManifest): string {
  const { manifestSha256: _digest, payload, ...rest } = manifest
  const {
    version: _version,
    workspaceSession: _session,
    clientState: _client,
    // Retention preserves journaled bytes even if their tab closes during transfer.
    terminalScrollbackSnapshots: _snapshots,
    ...dormant
  } = payload.dormantState ?? {}
  // UI-only changes can introduce a dormant payload that export previously omitted as empty.
  const empty = Object.values(dormant).every(
    (value) => value === undefined || (Array.isArray(value) && value.length === 0)
  )
  const frozen = { ...rest, payload: { ...payload, dormantState: empty ? undefined : dormant } }
  return createHash('sha256').update(serializeMadangdMigrationValue(frozen)).digest('hex')
}
