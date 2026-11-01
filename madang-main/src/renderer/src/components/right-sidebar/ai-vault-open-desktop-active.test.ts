import { describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import {
  desktopActiveIds,
  selectDesktopActiveSessionsToOpen,
  type DesktopActiveOpenCandidate
} from './ai-vault-open-desktop-active'

const session = (sessionId: string, agent: string = 'claude'): AiVaultSession =>
  ({ sessionId, agent }) as unknown as AiVaultSession

const usable = { blocked: false, usesSessionWorktree: true }

function candidate(
  id: string,
  overrides: Partial<DesktopActiveOpenCandidate> = {}
): DesktopActiveOpenCandidate {
  return { session: session(id), resume: usable, isOpen: false, ...overrides }
}

describe('selectDesktopActiveSessionsToOpen', () => {
  const activeIds = new Set(['a', 'b', 'c', 'd'])

  it('sorts active Claude sessions into the four groups', () => {
    const result = selectDesktopActiveSessionsToOpen({
      activeIds,
      candidates: [
        candidate('a'),
        candidate('b', { isOpen: true }),
        candidate('c', { resume: { blocked: false, usesSessionWorktree: false } }),
        candidate('d', { resume: { blocked: true, usesSessionWorktree: true } })
      ]
    })
    expect(result.toOpen.map((s) => s.sessionId)).toEqual(['a'])
    expect(result.alreadyOpen.map((s) => s.sessionId)).toEqual(['b'])
    expect(result.skippedNoProject.map((s) => s.sessionId)).toEqual(['c', 'd'])
    expect(result.remaining).toEqual([])
  })

  it('ignores archived, unknown and non-Claude sessions and duplicates', () => {
    const result = selectDesktopActiveSessionsToOpen({
      activeIds,
      candidates: [
        candidate('archived'),
        { ...candidate('a'), session: session('a', 'codex') },
        candidate('b'),
        candidate('b')
      ]
    })
    expect(result.toOpen.map((s) => s.sessionId)).toEqual(['b'])
  })

  it('opens at most the limit and reports the rest as remaining', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`)
    const result = selectDesktopActiveSessionsToOpen({
      activeIds: new Set(ids),
      candidates: ids.map((id) => candidate(id))
    })
    expect(result.toOpen).toHaveLength(10)
    expect(result.remaining.map((s) => s.sessionId)).toEqual(['s10', 's11'])
  })

  it('does not count already-open sessions against the limit', () => {
    const result = selectDesktopActiveSessionsToOpen({
      activeIds,
      limit: 1,
      candidates: [candidate('a', { isOpen: true }), candidate('b'), candidate('c')]
    })
    expect(result.toOpen.map((s) => s.sessionId)).toEqual(['b'])
    expect(result.remaining.map((s) => s.sessionId)).toEqual(['c'])
  })
})

describe('desktopActiveIds', () => {
  it('is known minus archived', () => {
    expect([...desktopActiveIds(new Set(['a', 'b']), new Set(['b', 'x']))]).toEqual(['a'])
  })
})
