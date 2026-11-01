import { translate } from '@/i18n/i18n'

// Why: these labels were built from English template strings in the menu model, so they never
// localized. Counts stay as interpolation values so each language can place them naturally.

/** Sleep menu label; a count is shown only when several workspaces are selected. */
export function getSleepMenuLabel(count: number | null): string {
  if (count === null) {
    return translate('auto.components.sidebar.WorktreeContextMenu.sleepLabel', 'Sleep')
  }
  return count === 1
    ? translate('auto.components.sidebar.WorktreeContextMenu.sleepCountOne', 'Sleep 1 Workspace')
    : translate(
        'auto.components.sidebar.WorktreeContextMenu.sleepCountMany',
        'Sleep {{count}} Workspaces',
        { count }
      )
}

/** Batch delete label; null count means the selection has nothing deletable. */
export function getDeleteSelectedMenuLabel(count: number | null): string {
  if (count === null) {
    return translate(
      'auto.components.sidebar.WorktreeContextMenu.deleteSelected',
      'Delete Selected'
    )
  }
  return count === 1
    ? translate('auto.components.sidebar.WorktreeContextMenu.deleteCountOne', 'Delete 1 Workspace')
    : translate(
        'auto.components.sidebar.WorktreeContextMenu.deleteCountMany',
        'Delete {{count}} Workspaces',
        { count }
      )
}
