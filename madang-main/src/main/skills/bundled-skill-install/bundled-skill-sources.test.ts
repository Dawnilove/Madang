import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { orcaCompatLegacySkillNames } from '../../../shared/skills/orca-compat-skill-names'
import { BUNDLED_SKILL_SOURCES } from './bundled-skill-sources'
import { bundledSkillTextDigest } from './classify'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')

describe('embedded bundled skill sources', () => {
  it('carry exactly the repo’s skills/*/SKILL.md, LF-normalised', async () => {
    const names = (await readdir(join(REPO_ROOT, 'skills'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(BUNDLED_SKILL_SOURCES.map((source) => source.name)).toEqual(names)
    for (const source of BUNDLED_SKILL_SOURCES) {
      const onDisk = await readFile(join(REPO_ROOT, 'skills', source.name, 'SKILL.md'), 'utf8')
      expect(source.text).toBe(onDisk.replace(/\r\n?/gu, '\n'))
    }
  })

  it('list this build’s digest and agree with the released ledger', async () => {
    const ledger = JSON.parse(
      await readFile(join(REPO_ROOT, 'resources', 'skills', 'released-digests.json'), 'utf8')
    )
    for (const source of BUNDLED_SKILL_SOURCES) {
      expect(source.releasedDigests).toContain(bundledSkillTextDigest(Buffer.from(source.text)))
      // 이름을 바꾼 스킬은 옛 이름의 출시 해시도 함께 싣는다.
      const names = [source.name, ...orcaCompatLegacySkillNames(source.name)]
      const expected = [...new Set(names.flatMap((name) => ledger.skills[name] ?? []))].sort()
      expect(source.releasedDigests).toEqual(expected)
    }
  })
})
