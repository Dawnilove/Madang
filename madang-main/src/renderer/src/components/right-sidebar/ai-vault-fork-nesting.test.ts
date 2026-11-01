import { describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { nestForkSessions } from './ai-vault-fork-nesting'

const session = (sessionId: string, title: string): AiVaultSession =>
  ({ id: `claude:${sessionId}`, sessionId, title }) as AiVaultSession

describe('nestForkSessions', () => {
  it('moves a fork under its parent with an arrow, and leaves a fork with an absent parent alone', () => {
    const groups = [
      { key: 'a', sessions: [session('p', 'Parent'), session('x', 'Other'), session('f', 'Fork')] },
      { key: 'b', sessions: [session('g', 'Orphan fork')] }
    ]
    const nested = nestForkSessions(
      groups,
      new Map([
        ['f', 'p'],
        ['g', 'missing']
      ])
    )
    expect(nested[0].sessions.map((s) => s.title)).toEqual(['Parent', '↳ Fork', 'Other'])
    expect(nested[1].sessions.map((s) => s.title)).toEqual(['Orphan fork'])
  })

  it('takes the desktop name for a session the desktop app names', () => {
    const groups = [{ key: 'a', sessions: [session('p', 'Claude Chat'), session('x', 'Other')] }]
    const named = nestForkSessions(groups, new Map(), new Map([['p', '학습기 메인']]))
    expect(named[0].sessions.map((s) => s.title)).toEqual(['학습기 메인', 'Other'])
  })

  it('lists a desktop session once even when two rows share its conversation id', () => {
    const copy = { ...session('p', 'Claude Chat'), id: 'claude:p:copy' }
    const groups = [{ key: 'a', sessions: [session('p', 'First'), copy, session('x', 'Other')] }]
    const named = nestForkSessions(groups, new Map(), new Map([['p', '학습기 메인']]))
    expect(named[0].sessions.map((s) => s.title)).toEqual(['학습기 메인', 'Other'])
  })

  it('returns the groups unchanged when there are no forks', () => {
    const groups = [{ key: 'a', sessions: [session('p', 'Parent')] }]
    expect(nestForkSessions(groups, new Map())).toEqual(groups)
  })
})
