import { describe, expect, it } from 'vitest'
import { parseSkillShareId } from '../skill-share-link'
import { parseOrcaCompatSkillShareLink } from './orca-compat-skill-share'

describe('parseOrcaCompatSkillShareLink', () => {
  it('reads Orca share links', () => {
    expect(parseOrcaCompatSkillShareLink('https://app.orca.dev/skills/share/abc_123-x')).toBe(
      'abc_123-x'
    )
    expect(parseOrcaCompatSkillShareLink('https://share.onorca.dev/skills/share/abc/')).toBe('abc')
    expect(parseOrcaCompatSkillShareLink('orca://skills/share/abc')).toBe('abc')
  })

  it.each([
    'abc123',
    'http://app.orca.dev/skills/share/abc',
    'https://evil.example/skills/share/abc',
    'https://app.orca.dev.evil.example/skills/share/abc',
    'https://user@app.orca.dev/skills/share/abc',
    'https://app.orca.dev:8443/skills/share/abc',
    'https://app.orca.dev/skills/other/abc',
    'https://app.orca.dev/skills/share/a/b',
    'madang://skills/share/abc',
    'not a url'
  ])('rejects %s', (value) => {
    expect(parseOrcaCompatSkillShareLink(value)).toBeNull()
  })

  it('leaves the built-in link parser closed to Orca hosts', () => {
    expect(parseSkillShareId('https://app.orca.dev/skills/share/abc')).toBeNull()
  })
})
