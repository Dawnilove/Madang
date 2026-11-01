import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BundledSkillSource } from './bundled-skill-sources'
import { previewBundledSkillInstall } from './service'
import {
  linkDirectory,
  makeSkillHome,
  previewAndInstall,
  removeSkillHomes,
  serviceInput,
  writeCopy,
  type SkillHome
} from './skill-home.test-support'

afterEach(removeSkillHomes)

const LEGACY = 'orca-cli'
const CURRENT = 'madang-cli'
const LEGACY_TEXT = `---\nname: ${LEGACY}\ndescription: Old\n---\n\nOld body\n`
const CURRENT_TEXT = `---\nname: ${CURRENT}\ndescription: New\n---\n\nNew body\n`
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
// 생성기가 하는 대로 옛 이름의 출시 해시를 새 이름 출시 목록에 합친다.
const SOURCE: BundledSkillSource = {
  name: CURRENT,
  text: CURRENT_TEXT,
  releasedDigests: [digest(LEGACY_TEXT), digest(CURRENT_TEXT)]
}

const input = (home: SkillHome, options: Parameters<typeof serviceInput>[1] = {}) => ({
  ...serviceInput(home, options),
  sources: [SOURCE]
})
const skillPath = (home: SkillHome, root: '.agents' | '.claude', name: string) =>
  join(home.home, root, 'skills', name)
const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false
  )
const backups = async (home: SkillHome) =>
  (await readdir(join(home.home, '.agents', '.orca-skill-backups')).catch(() => [])).length

describe('legacy Orca skill names', () => {
  it('installs the new name on a clean home', async () => {
    const home = await makeSkillHome()
    await previewAndInstall(input(home))
    expect(await readFile(join(skillPath(home, '.claude', CURRENT), 'SKILL.md'), 'utf8')).toBe(
      CURRENT_TEXT
    )
  })

  it('backs up an untouched legacy copy and installs the new name', async () => {
    const home = await makeSkillHome()
    await writeCopy(skillPath(home, '.claude', LEGACY), LEGACY_TEXT)
    await previewAndInstall(input(home))
    expect(await exists(skillPath(home, '.claude', LEGACY))).toBe(false)
    expect(await readFile(join(skillPath(home, '.claude', CURRENT), 'SKILL.md'), 'utf8')).toBe(
      CURRENT_TEXT
    )
    expect(await backups(home)).toBe(1)
  })

  it('keeps a legacy copy the user edited', async () => {
    const home = await makeSkillHome()
    const mine = `${LEGACY_TEXT}my notes\n`
    await writeCopy(skillPath(home, '.claude', LEGACY), mine)
    await previewAndInstall(input(home))
    expect(await readFile(join(skillPath(home, '.claude', LEGACY), 'SKILL.md'), 'utf8')).toBe(mine)
    expect(await exists(skillPath(home, '.claude', CURRENT))).toBe(true)
    expect(await backups(home)).toBe(0)
  })

  it('keeps a same-name folder the user made with extra files', async () => {
    const home = await makeSkillHome()
    await writeCopy(skillPath(home, '.claude', LEGACY), LEGACY_TEXT, { 'run.sh': 'echo mine' })
    await previewAndInstall(input(home))
    expect(await readFile(join(skillPath(home, '.claude', LEGACY), 'run.sh'), 'utf8')).toBe(
      'echo mine'
    )
    expect(await backups(home)).toBe(0)
  })

  it('backs up the shared legacy copy and the agent link that points at it', async () => {
    const home = await makeSkillHome()
    await writeCopy(skillPath(home, '.agents', LEGACY), LEGACY_TEXT)
    await mkdir(join(home.home, '.claude', 'skills'), { recursive: true })
    await linkDirectory(skillPath(home, '.agents', LEGACY), skillPath(home, '.claude', LEGACY))
    await previewAndInstall(input(home))
    expect(await exists(skillPath(home, '.agents', LEGACY))).toBe(false)
    expect(await exists(skillPath(home, '.claude', LEGACY))).toBe(false)
    expect(await readFile(join(skillPath(home, '.claude', CURRENT), 'SKILL.md'), 'utf8')).toBe(
      CURRENT_TEXT
    )
  })

  it('keeps an agent link whose shared legacy copy was edited', async () => {
    const home = await makeSkillHome()
    await writeCopy(skillPath(home, '.agents', LEGACY), `${LEGACY_TEXT}edited\n`)
    await mkdir(join(home.home, '.claude', 'skills'), { recursive: true })
    await linkDirectory(skillPath(home, '.agents', LEGACY), skillPath(home, '.claude', LEGACY))
    await previewAndInstall(input(home))
    expect(await exists(join(skillPath(home, '.claude', LEGACY), 'SKILL.md'))).toBe(true)
  })

  it('does not spread to a new location during an update of installed skills', async () => {
    const home = await makeSkillHome()
    await writeCopy(skillPath(home, '.claude', LEGACY), LEGACY_TEXT)
    const plan = await previewBundledSkillInstall(input(home, { installedOnly: true }))
    expect(plan.skills).toEqual([])
    expect(await exists(skillPath(home, '.claude', LEGACY))).toBe(true)
  })

  it('backs up the legacy copy while updating an older new-name copy', async () => {
    const home = await makeSkillHome()
    await writeCopy(skillPath(home, '.claude', LEGACY), LEGACY_TEXT)
    await writeCopy(skillPath(home, '.claude', CURRENT), LEGACY_TEXT)
    await previewAndInstall(input(home, { installedOnly: true }))
    expect(await exists(skillPath(home, '.claude', LEGACY))).toBe(false)
    expect(await readFile(join(skillPath(home, '.claude', CURRENT), 'SKILL.md'), 'utf8')).toBe(
      CURRENT_TEXT
    )
  })

  it('selects the new skill when the old name is asked for', async () => {
    const home = await makeSkillHome()
    await previewAndInstall({ ...input(home), names: [LEGACY] })
    expect(await exists(skillPath(home, '.claude', CURRENT))).toBe(true)
  })
})
