// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { markCollaborationTab, COLLABORATION_MARKER } from './collaboration-sessions'

describe('collaboration sessions', () => {
  it('persists a marked tab so the badge survives a restart', () => {
    markCollaborationTab('tab-1')
    expect(JSON.parse(localStorage.getItem('madang.collaborationTabs') ?? '[]')).toContain('tab-1')
  })

  it('uses a marker the skill description names', () => {
    expect(COLLABORATION_MARKER).toBe('[협업] ')
  })
})
