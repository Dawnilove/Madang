import { describe, expect, it } from 'vitest'
import { mergeLocale } from './merge-upstream-locale.mjs'

describe('mergeLocale', () => {
  const base = { a: { x: 'base-x', y: 'base-y' }, z: 'base-z' }

  it('takes upstream additions and changes to keys we did not touch', () => {
    const conflicts = []
    const merged = mergeLocale(
      base,
      base,
      { a: { x: 'up-x', y: 'base-y', n: 'new' }, z: 'base-z' },
      '',
      conflicts
    )
    expect(merged).toEqual({ a: { x: 'up-x', y: 'base-y', n: 'new' }, z: 'base-z' })
    expect(conflicts).toEqual([])
  })

  it('keeps our edits and our added keys', () => {
    const ours = { a: { x: '우리-x', y: 'base-y', mine: '추가' }, z: 'base-z' }
    const merged = mergeLocale(base, ours, { a: { x: 'base-x', y: 'up-y' }, z: 'base-z' })
    expect(merged.a).toEqual({ x: '우리-x', y: 'up-y', mine: '추가' })
  })

  it('keeps ours and reports a key both sides changed', () => {
    const conflicts = []
    const ours = { a: { x: '우리-x', y: 'base-y' }, z: 'base-z' }
    const merged = mergeLocale(
      base,
      ours,
      { a: { x: 'up-x', y: 'base-y' }, z: 'base-z' },
      '',
      conflicts
    )
    expect(merged.a.x).toBe('우리-x')
    expect(conflicts).toEqual(['a.x'])
  })

  it('drops a key upstream removed only when we never edited it', () => {
    const ours = { a: { x: '우리-x', y: 'base-y' }, z: 'base-z' }
    const merged = mergeLocale(base, ours, { a: {} })
    expect(merged).toEqual({ a: { x: '우리-x' } })
  })
})
