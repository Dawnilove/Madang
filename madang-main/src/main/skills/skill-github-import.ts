import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { GithubSkillSource } from '../../shared/skill-github-url'
import { normalizeSkillBundleName } from '../../shared/skill-bundle-name'
import {
  validateSkillPackageName,
  validateSkillPackagePath
} from '../../shared/skill-package-manifest'
import { summarizeSkillMarkdown } from '../../shared/skill-metadata'
import { createSkillBundleArchive, type SkillBundleSource } from './skill-bundle-creation'
import { downloadGithubTarball, expandGithubTarball, type TarFile } from './skill-github-tarball'
import { SkillImportError, skillImportErrorCode } from './skill-import-error'
import { versionFromCreatedBundle, type ImportedBundle } from './skill-bundle-file-import'

const MAX_SKILLS = 100
const MAX_FILES_PER_SKILL = 512
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_SKILL_BYTES = 32 * 1024 * 1024

type SkillCandidate = { name: string; description: string; files: TarFile[] }

/** Drops the archive's top folder and refuses paths that could leave the folder they are written to. */
function relativeFiles(files: readonly TarFile[], source: GithubSkillSource): TarFile[] {
  const result: TarFile[] = []
  for (const file of files) {
    const segments = file.path.split('/')
    const relative = segments.slice(1)
    if (
      segments[0] === '' ||
      relative.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      segments.some(
        (segment) => segment === '..' || segment.includes('\\') || segment.includes('\0')
      )
    ) {
      throw new SkillImportError('unsafe')
    }
    const path = relative.join('/')
    if (path && (!source.path || path === source.path || path.startsWith(`${source.path}/`))) {
      result.push({ ...file, path })
    }
  }
  return result
}

/** A skill is the outermost folder that holds a SKILL.md; deeper SKILL.md files stay inside it. */
function skillFolders(files: readonly TarFile[]): string[] {
  const folders = files
    .filter((file) => file.path === 'SKILL.md' || file.path.endsWith('/SKILL.md'))
    .map((file) => file.path.slice(0, -'SKILL.md'.length).replace(/\/$/, ''))
    .sort((left, right) => left.length - right.length)
  const kept: string[] = []
  for (const folder of folders) {
    if (!kept.some((outer) => outer === '' || folder === outer || folder.startsWith(`${outer}/`))) {
      kept.push(folder)
    }
  }
  return kept
}

function candidateFor(folder: string, files: readonly TarFile[]): SkillCandidate | null {
  const inside = files
    .filter((file) => !folder || file.path.startsWith(`${folder}/`))
    .map((file) => ({ ...file, path: folder ? file.path.slice(folder.length + 1) : file.path }))
  const markdown = inside.find((file) => file.path === 'SKILL.md')
  if (
    !markdown ||
    inside.length > MAX_FILES_PER_SKILL ||
    inside.some((file) => file.data.length > MAX_FILE_BYTES) ||
    inside.reduce((sum, file) => sum + file.data.length, 0) > MAX_SKILL_BYTES
  ) {
    return null
  }
  try {
    for (const file of inside) {
      validateSkillPackagePath(file.path)
    }
    const summary = summarizeSkillMarkdown(markdown.data.toString('utf8'))
    if (!summary.name) {
      return null
    }
    validateSkillPackageName(summary.name)
    return { name: summary.name, description: summary.description ?? '', files: inside }
  } catch {
    return null
  }
}

/** Skills found in a GitHub tar, plus how many SKILL.md folders had to be left out. */
export function findGithubSkills(
  files: readonly TarFile[],
  source: GithubSkillSource
): { skills: SkillCandidate[]; skippedCount: number } {
  const scoped = relativeFiles(files, source)
  const folders = skillFolders(scoped)
  if (folders.length > MAX_SKILLS) {
    throw new SkillImportError('too-large')
  }
  const names = new Set<string>()
  const skills: SkillCandidate[] = []
  for (const folder of folders) {
    const candidate = candidateFor(folder, scoped)
    const folded = candidate?.name.toLocaleLowerCase('en-US')
    if (candidate && folded && !names.has(folded)) {
      names.add(folded)
      skills.push(candidate)
    }
  }
  return { skills, skippedCount: folders.length - skills.length }
}

async function writeSkill(directory: string, skill: SkillCandidate): Promise<Set<string>> {
  const executable = new Set<string>()
  for (const file of skill.files) {
    const destination = join(directory, ...file.path.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, file.data, { flag: 'wx', mode: file.executable ? 0o755 : 0o644 })
    if (file.executable) {
      executable.add(file.path)
    }
  }
  return executable
}

/** Downloads a GitHub repository (or folder), finds SKILL.md folders and packs them as a bundle. */
export async function importSkillsFromGithub(
  source: GithubSkillSource,
  fetcher?: typeof fetch
): Promise<ImportedBundle & { skippedCount: number }> {
  const files = await expandGithubTarball(await downloadGithubTarball(source, fetcher))
  const { skills, skippedCount } = findGithubSkills(files, source)
  if (skills.length === 0) {
    throw new SkillImportError('no-skills')
  }
  const work = await mkdtemp(join(tmpdir(), 'madang-github-skills-'))
  try {
    const sources: SkillBundleSource[] = []
    for (const [index, skill] of skills.entries()) {
      const sourceDirectory = join(work, 'skills', String(index))
      sources.push({
        id: skill.name,
        sourceDirectory,
        executablePaths: await writeSkill(sourceDirectory, skill)
      })
    }
    const archivePath = join(work, 'bundle.tar.gz')
    const created = await createSkillBundleArchive({
      sources,
      archivePath,
      packageId: randomUUID(),
      versionId: randomUUID(),
      bundleName: normalizeSkillBundleName(source.repo) || 'github-skills',
      description: `github.com/${source.owner}/${source.repo}${source.path ? `/${source.path}` : ''}`
    })
    await rm(join(work, 'skills'), { recursive: true, force: true })
    return {
      archivePath,
      version: versionFromCreatedBundle(created),
      cleanup: () => rm(work, { recursive: true, force: true }),
      skippedCount
    }
  } catch (error) {
    await rm(work, { recursive: true, force: true })
    throw new SkillImportError(skillImportErrorCode(error))
  }
}
