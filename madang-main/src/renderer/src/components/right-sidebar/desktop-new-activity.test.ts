import { describe, expect, it } from 'vitest'
import type { ClaudeDesktopActiveSession } from '../../../../shared/ai-vault-types'
import { takeNewDesktopActivity } from './desktop-new-activity'

const session = (sessionId: string, lastActivityAt?: number): ClaudeDesktopActiveSession => ({
  sessionId,
  title: sessionId,
  cwd: '/p',
  originCwd: '/p',
  lastActivityAt
})

describe('takeNewDesktopActivity', () => {
  it('records the first sighting without reporting it', () => {
    const seen = new Map<string, number>()
    expect(takeNewDesktopActivity([session('a', 10)], seen, () => true)).toEqual([])
    expect(seen.get('a')).toBe(10)
  })

  it('reports an open chat once when the desktop activity moves forward', () => {
    const seen = new Map([['a', 10]])
    expect(takeNewDesktopActivity([session('a', 20)], seen, () => true)).toEqual(['a'])
    expect(takeNewDesktopActivity([session('a', 20)], seen, () => true)).toEqual([])
  })

  it('ignores sessions without an open chat or without a timestamp', () => {
    const seen = new Map([['a', 10]])
    expect(takeNewDesktopActivity([session('a', 20)], seen, () => false)).toEqual([])
    expect(takeNewDesktopActivity([session('b')], seen, () => true)).toEqual([])
  })
})
