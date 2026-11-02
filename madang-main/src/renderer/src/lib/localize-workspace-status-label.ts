import { translate } from '@/i18n/i18n'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../shared/workspace-status-defaults'

const KEY_BY_ID: Record<string, string> = {
  todo: 'todo',
  'in-progress': 'inProgress',
  'in-review': 'inReview',
  completed: 'done'
}

/** Stored labels stay as saved; only a label still equal to the built-in English default is localized for display. */
export function localizeWorkspaceStatusLabel(status: { id: string; label: string }): string {
  const builtIn = DEFAULT_WORKSPACE_STATUSES.find((entry) => entry.id === status.id)
  const key = KEY_BY_ID[status.id]
  if (!builtIn || !key || builtIn.label !== status.label) {
    return status.label
  }
  return translate(`madang.workspaceStatus.${key}`, status.label)
}
