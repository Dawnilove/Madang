import type { MadangdMigrationManifest } from '../../../shared/madangd-migration/madangd-migration-manifest'
import {
  MADANGD_MIGRATION_DEPENDENCY_KINDS,
  type MadangdMigrationDependencyKind
} from '../../../shared/madangd-migration/madangd-migration-preflight'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { TerminalScrollbackSnapshotStorage } from '../../terminal-scrollback-snapshots'
import {
  inspectMadangdMigrationSourceSessions,
  type MadangdMigrationSourceSessionInspection
} from './madangd-source-session-dependencies'
import {
  collectMadangdMigrationSourceDormantState,
  madangdMigrationLeavesBehind
} from './madangd-source-dormant-state'
import {
  createMadangdMigrationSourceScope,
  madangdMigrationOwnerMatchesScope,
  madangdMigrationPartitionScope,
  type MadangdMigrationSourceScope
} from './madangd-source-scope'
import { paneBelongsToTabs } from '../../../shared/workspace-session-pane-ownership'

export type MadangdMigrationSourceDependencyCensus = {
  totalCount: number
  counts: Record<MadangdMigrationDependencyKind, number>
  /** Blocker names and remedies where available. */
  names?: Partial<Record<MadangdMigrationDependencyKind, string[]>>
}

export function collectMadangdMigrationUntransferredDependencyCensus(
  state: PersistedState,
  manifest: MadangdMigrationManifest,
  storage?: TerminalScrollbackSnapshotStorage
): MadangdMigrationSourceDependencyCensus {
  const scope = createMadangdMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const sessions = inspectMadangdMigrationSourceSessions(state, {
    hostId: scope.hostId,
    ownerMatches: (ownerKey, partitionHostId) =>
      madangdMigrationOwnerMatchesScope(
        ownerKey,
        madangdMigrationPartitionScope(scope, partitionHostId)
      )
  })
  const dormant = collectMadangdMigrationSourceDormantState(
    state,
    manifest.source,
    manifest.payload,
    storage,
    manifest.destinationEnvironmentId
  )
  const counts: Record<MadangdMigrationDependencyKind, number> = {
    ...dormant.blockedCounts,
    'terminal-lease': state.sshRemotePtyLeases.filter(
      (lease) => lease.targetId === scope.targetId && lease.state !== 'terminated'
    ).length,
    // Retained recoveries can stay behind; the terminal gate still requires exit.
    'terminal-recovery': madangdMigrationLeavesBehind(state, scope.targetId)
      ? 0
      : countTerminalRecoveryState(state, scope, sessions)
  }
  return {
    counts,
    totalCount: MADANGD_MIGRATION_DEPENDENCY_KINDS.reduce((total, kind) => total + counts[kind], 0),
    names:
      dormant.blockedSessionItems.length > 0
        ? { 'workspace-session': dormant.blockedSessionItems }
        : {}
  }
}

// The terminal gate proves recovery leases exited; hook aliases add no independent terminal ownership.
function countTerminalRecoveryState(
  state: PersistedState,
  scope: MadangdMigrationSourceScope,
  sessions: MadangdMigrationSourceSessionInspection
): number {
  return state.migrationUnsupportedPtyEntries.filter(
    (entry) =>
      madangdMigrationOwnerMatchesScope(entry.worktreeId, scope) ||
      (entry.tabId ? sessions.tabIds.has(entry.tabId) : false) ||
      sessions.ptyIds.has(entry.ptyId) ||
      (entry.paneKey ? paneBelongsToTabs(entry.paneKey, sessions.tabIds) : false)
  ).length
}
