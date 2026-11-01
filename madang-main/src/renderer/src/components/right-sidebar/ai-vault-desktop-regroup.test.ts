import { describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { regroupByDesktopGroup } from './ai-vault-desktop-regroup'

const session = (sessionId: string): AiVaultSession =>
  ({ id: `claude:${sessionId}`, sessionId, title: sessionId }) as AiVaultSession
const grp = (id: string, name: string, rank: number, sessionRank: number) => ({
  id,
  name,
  rank,
  sessionRank
})

describe('regroupByDesktopGroup', () => {
  it('files sessions under the desktop group in desktop order and leaves ungrouped sessions in their folder group', () => {
    const groups = [
      { key: 'f1', label: 'CAPEK', sessions: [session('a'), session('b'), session('c')] },
      { key: 'f2', label: 'Madang', sessions: [session('d')] }
    ]
    const regrouped = regroupByDesktopGroup(
      groups,
      new Map([
        ['a', grp('g1', 'Physical AI', 7, 1)],
        ['b', grp('g1', 'Physical AI', 7, 0)],
        ['d', grp('g2', 'ADAK', 3, 0)]
      ])
    )
    expect(regrouped.map((g) => g.label)).toEqual(['ADAK', 'Physical AI', 'CAPEK'])
    expect(regrouped[1].sessions.map((s) => s.sessionId)).toEqual(['b', 'a'])
    expect(regrouped[2].sessions.map((s) => s.sessionId)).toEqual(['c'])
  })

  it('files ungrouped desktop sessions under their project folder, so a worktree session joins its project', () => {
    const groups = [
      { key: 'f1', label: 'worktrees/x', sessions: [session('a')] },
      { key: 'f2', label: 'Desktop/Madang', sessions: [session('b')] },
      { key: 'f3', label: 'Other', sessions: [session('z')] }
    ]
    const regrouped = regroupByDesktopGroup(
      groups,
      new Map(),
      new Map([
        ['a', 'C:/w/Madang'],
        ['b', 'C:/w/Madang']
      ])
    )
    expect(regrouped.map((g) => g.label)).toEqual(['Madang', 'Other'])
    expect(regrouped[0].sessions.map((s) => s.sessionId)).toEqual(['a', 'b'])
  })

  it('returns the groups unchanged without desktop groups', () => {
    const groups = [{ key: 'f1', label: 'CAPEK', sessions: [session('a')] }]
    expect(regroupByDesktopGroup(groups, new Map())).toEqual(groups)
  })
})
