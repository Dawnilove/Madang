import type { PersistedState } from '../../../shared/persisted-state-types'
import type {
  MadangdMigrationClientStatePayload,
  MadangdMigrationUiRoutingState
} from '../../../shared/madangd-migration/madangd-migration-client-state'
import { serializeMadangdMigrationValue } from '../../../shared/madangd-migration/madangd-migration-manifest'

export type PreparedMadangdMigrationClientState = {
  incoming: MadangdMigrationClientStatePayload | undefined
  mobileSelections: NonNullable<
    MadangdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']
  >
  uiRouting: MadangdMigrationUiRoutingState | undefined
}

export function prepareMadangdMigrationClientState(
  incoming: MadangdMigrationClientStatePayload | undefined,
  state: PersistedState
): PreparedMadangdMigrationClientState {
  const mobileSelections = prepareMobileSelections(
    incoming?.mobileClientTabSelectionsByDeviceId,
    state
  )
  const uiRouting = incoming?.uiRouting ? structuredClone(incoming.uiRouting) : undefined
  return {
    incoming,
    mobileSelections,
    uiRouting
  }
}

export function applyPreparedMadangdMigrationClientState(
  prepared: PreparedMadangdMigrationClientState,
  state: PersistedState
): void {
  if (Object.keys(prepared.mobileSelections).length > 0) {
    state.mobileClientTabSelectionsByDeviceId = { ...state.mobileClientTabSelectionsByDeviceId }
    for (const [deviceId, selections] of Object.entries(prepared.mobileSelections)) {
      state.mobileClientTabSelectionsByDeviceId[deviceId] = {
        ...state.mobileClientTabSelectionsByDeviceId[deviceId],
        ...selections
      }
    }
  }
  if (prepared.uiRouting) {
    applyUiRouting(prepared.uiRouting, state)
  }
}

function prepareMobileSelections(
  incoming: MadangdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId'],
  state: PersistedState
): NonNullable<MadangdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']> {
  const result: NonNullable<
    MadangdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']
  > = {}
  const current = state.mobileClientTabSelectionsByDeviceId ?? {}
  for (const [deviceId, selections] of Object.entries(incoming ?? {})) {
    for (const [worktreeId, selection] of Object.entries(selections)) {
      const existing = current[deviceId]?.[worktreeId]
      if (
        existing &&
        serializeMadangdMigrationValue(existing) !== serializeMadangdMigrationValue(selection)
      ) {
        throw new Error(`madangd_migration_client_state_conflict:mobile:${deviceId}:${worktreeId}`)
      }
      const deviceSelections = (result[deviceId] ??= {})
      deviceSelections[worktreeId] = structuredClone(selection)
    }
  }
  return result
}

type UiRoutingKey = keyof MadangdMigrationUiRoutingState
type UiRoutingFieldMerge<K extends UiRoutingKey> =
  /** Per-window filters stay on the desktop. */
  | 'desktop-only'
  /** Preserve the server's existing value. */
  | ((ui: PersistedState['ui'], value: NonNullable<MadangdMigrationUiRoutingState[K]>) => void)

// View state cannot block a move: preserve server values and merge acknowledgements by latest time.
export const MADANGD_MIGRATION_UI_ROUTING_MERGE: {
  readonly [K in UiRoutingKey]: UiRoutingFieldMerge<K>
} = {
  lastActiveRepoId: (ui, value) => {
    ui.lastActiveRepoId ??= value
  },
  lastActiveWorktreeId: (ui, value) => {
    ui.lastActiveWorktreeId ??= value
  },
  manualRepoOrder: (ui, value) => {
    if (!ui.manualRepoOrder?.length) {
      ui.manualRepoOrder = structuredClone(value)
    }
  },
  showDotfilesByWorktree: (ui, value) => {
    ui.showDotfilesByWorktree = { ...structuredClone(value), ...ui.showDotfilesByWorktree }
  },
  acknowledgedAgentsByPaneKey: (ui, value) => {
    // A retry must not revive an already-acknowledged unread mark.
    const merged = { ...ui.acknowledgedAgentsByPaneKey }
    for (const [paneKey, at] of Object.entries(value)) {
      merged[paneKey] = Math.max(merged[paneKey] ?? 0, at)
    }
    ui.acknowledgedAgentsByPaneKey = merged
  },
  setupScriptPromptDismissedRepoIds: (ui, value) => {
    ui.setupScriptPromptDismissedRepoIds = [
      ...new Set([...(ui.setupScriptPromptDismissedRepoIds ?? []), ...value])
    ]
  },
  filterRepoIds: 'desktop-only',
  workspaceHostScope: 'desktop-only',
  visibleWorkspaceHostIds: 'desktop-only',
  workspaceHostOrder: 'desktop-only',
  automationHostFilter: 'desktop-only'
}

const UI_ROUTING_KEYS = Object.keys(MADANGD_MIGRATION_UI_ROUTING_MERGE).filter(isUiRoutingKey)

function isUiRoutingKey(key: string): key is UiRoutingKey {
  return Object.hasOwn(MADANGD_MIGRATION_UI_ROUTING_MERGE, key)
}

function applyUiRouting(route: MadangdMigrationUiRoutingState, state: PersistedState): void {
  for (const key of UI_ROUTING_KEYS) {
    mergeUiRoutingField(key, route, state.ui)
  }
}

function mergeUiRoutingField<K extends UiRoutingKey>(
  key: K,
  route: MadangdMigrationUiRoutingState,
  ui: PersistedState['ui']
): void {
  const merge = MADANGD_MIGRATION_UI_ROUTING_MERGE[key]
  const value = route[key]
  if (merge !== 'desktop-only' && value !== undefined && value !== null) {
    merge(ui, value)
  }
}
