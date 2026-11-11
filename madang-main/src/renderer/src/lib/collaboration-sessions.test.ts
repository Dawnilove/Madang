// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import {
  markCollaborationTab,
  COLLABORATION_MARKER,
  COLLABORATION_RULES_HINT
} from './collaboration-sessions'

describe('collaboration sessions', () => {
  it('persists a marked tab so the badge survives a restart', () => {
    markCollaborationTab('tab-1')
    expect(JSON.parse(localStorage.getItem('madang.collaborationTabs') ?? '[]')).toContain('tab-1')
  })

  it('uses a marker the skill description names', () => {
    expect(COLLABORATION_MARKER).toBe('[협업] ')
  })

  it('hints the CLI command that serves the rules without the installed skill', () => {
    expect(COLLABORATION_RULES_HINT).toContain('madang skills get collaboration')
  })
})
