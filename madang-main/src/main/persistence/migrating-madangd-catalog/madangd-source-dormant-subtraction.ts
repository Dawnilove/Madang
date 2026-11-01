import type { MadangdMigrationManifest } from '../../../shared/madangd-migration/madangd-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { subtractMadangdSourceWorktreeMetadata } from './madangd-source-worktree-metadata'
import { subtractMadangdMigrationSourceAutomationState } from './madangd-source-automation-subtraction'
import { subtractMadangdMigrationSourceWorkspaceSession } from './madangd-source-workspace-session-subtraction'
import { subtractMadangdMigrationClientState } from './madangd-source-client-subtraction'

/** Mutate a delta-view copy only. */
export function subtractMadangdMigrationSourceDormantState(
  state: PersistedState,
  manifest: MadangdMigrationManifest
): void {
  // Include state a downgraded build added even when the manifest had none.
  subtractMadangdSourceWorktreeMetadata(state, manifest)
  subtractMadangdMigrationSourceAutomationState(state, manifest)
  const dormant = manifest.payload.dormantState
  if (!dormant) {
    return
  }
  dormant.worktreeLineage.forEach((entry) => delete state.worktreeLineageById[entry.sourceKey])
  dormant.workspaceLineage.forEach(
    (entry) => delete state.workspaceLineageByChildKey[entry.sourceKey]
  )
  for (const preset of dormant.sparsePresets) {
    const remaining = (state.sparsePresetsByRepo[preset.repoId] ?? []).filter(
      (entry) => entry.id !== preset.id
    )
    if (remaining.length > 0) {
      state.sparsePresetsByRepo[preset.repoId] = remaining
    } else {
      delete state.sparsePresetsByRepo[preset.repoId]
    }
  }
  for (const entry of dormant.retiredWorktreeNames) {
    delete state.retiredWorktreeNamesByRepo?.[entry.repoId]
  }
  subtractMadangdMigrationSourceWorkspaceSession(state, manifest)
  subtractMadangdMigrationClientState(state, manifest)
  // Retain snapshot files: the prior durable profile and rollback evidence can still reference them.
}
