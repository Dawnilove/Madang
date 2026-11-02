import { describe, expect, it } from 'vitest'
import { localizeWorkspaceStatusLabel } from './localize-workspace-status-label'

describe('localizeWorkspaceStatusLabel', () => {
  it('keeps a renamed built-in status and any custom status as saved', () => {
    expect(localizeWorkspaceStatusLabel({ id: 'todo', label: 'Backlog' })).toBe('Backlog')
    expect(localizeWorkspaceStatusLabel({ id: 'custom-1', label: 'Parked' })).toBe('Parked')
  })

  it('returns the label for a built-in status when no translation is loaded', () => {
    expect(localizeWorkspaceStatusLabel({ id: 'in-progress', label: 'In progress' })).toBe(
      'In progress'
    )
  })
})
