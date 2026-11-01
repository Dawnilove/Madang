import { describe, expect, it } from 'vitest'
import { parseGithubSkillUrl } from './skill-github-url'

describe('parseGithubSkillUrl', () => {
  it('reads a repository address', () => {
    expect(parseGithubSkillUrl('https://github.com/anthropics/skills')).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: null,
      path: ''
    })
    expect(parseGithubSkillUrl('  https://github.com/o/r.git/  ')).toMatchObject({ repo: 'r' })
  })

  it('reads a tree address with a ref and a folder', () => {
    expect(parseGithubSkillUrl('https://github.com/o/r/tree/main/skills/pdf')).toEqual({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      path: 'skills/pdf'
    })
    expect(parseGithubSkillUrl('https://github.com/o/r/tree/v1.2.0')).toMatchObject({
      ref: 'v1.2.0',
      path: ''
    })
  })

  it('lets the URL parser resolve dot segments before any path is used', () => {
    expect(parseGithubSkillUrl('https://github.com/o/r/tree/main/a/../b')).toMatchObject({
      path: 'b'
    })
  })

  it.each([
    'http://github.com/o/r',
    'https://gitlab.com/o/r',
    'https://github.com.evil.example/o/r',
    'https://evil.example/github.com/o/r',
    'https://user:pw@github.com/o/r',
    'https://github.com:444/o/r',
    'https://github.com/o',
    'https://github.com/o/r/blob/main/SKILL.md',
    'https://github.com/o/r/tree',
    'https://github.com/o/r/tree/main/a%2Fb',
    'https://github.com/-bad-/r',
    'git@github.com:o/r.git',
    'not a url',
    ''
  ])('rejects %s', (value) => {
    expect(parseGithubSkillUrl(value)).toBeNull()
  })
})
