import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_PLUGIN_MANIFEST_PATH,
  ORCA_SKILL_BUNDLE_MANIFEST_PATH
} from '../../shared/skill-bundle-manifest'
import { exportSkillBundle } from './skill-bundle-file-export'
import { inspectSkillBundleFile } from './skill-bundle-file-import'
import { installSkillBundle } from './skill-bundle-install-service'
import { writeSkillTarGzip } from './skill-package-tar'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'madang-skill-file-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createSkill(root: string, name: string, extra?: string): Promise<string> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n---\n\n# ${name}\n`
  )
  if (extra) {
    await writeFile(join(directory, 'notes.txt'), extra)
  }
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('skill bundle file export and import', () => {
  it('exports skills, inspects the file, and installs it through the bundle installer', async () => {
    const root = await temporaryDirectory()
    const alpha = await createSkill(join(root, 'src'), 'alpha', 'hello from alpha')
    const beta = await createSkill(join(root, 'src'), 'beta')
    const archivePath = join(root, 'out', 'team.tar.gz')

    await exportSkillBundle({
      skills: [
        { name: 'alpha', directoryPath: alpha },
        { name: 'beta', directoryPath: beta }
      ],
      bundleName: 'alpha-and-1-more',
      archivePath
    })
    const inspected = await inspectSkillBundleFile(archivePath)

    expect(inspected.archivePath).toBe(archivePath)
    expect(inspected.version.name).toBe('alpha-and-1-more')
    const manifest = inspected.version.manifest
    expect('skills' in manifest && manifest.skills.map((skill) => skill.name)).toEqual([
      'alpha',
      'beta'
    ])

    const result = await installSkillBundle({
      operationId: 'operation_round_trip',
      archivePath,
      packageId: inspected.version.packageId,
      versionId: inspected.version.versionId,
      bundleDigest: 'skills' in manifest ? manifest.bundleDigest : '',
      selectedSkillIds: ['alpha', 'beta'],
      expectedArchiveSha256: inspected.version.archiveSha256,
      scope: 'global',
      homeDirectory: join(root, 'home'),
      orcaStateDirectory: join(root, 'state'),
      detectedProviders: [],
      destinationIdentity: 'local-global',
      hostIdentity: 'host_1'
    })

    expect(result.status).toBe('complete')
    await expect(
      readFile(join(root, 'home', '.agents', 'skills', 'alpha', 'notes.txt'), 'utf8')
    ).resolves.toBe('hello from alpha')
    await expect(
      stat(join(root, 'home', '.agents', 'skills', 'beta', 'SKILL.md'))
    ).resolves.toBeTruthy()
  })

  it('refuses two skills with the same name', async () => {
    const root = await temporaryDirectory()
    const first = await createSkill(join(root, 'one'), 'alpha')
    const second = await createSkill(join(root, 'two'), 'alpha')
    await expect(
      exportSkillBundle({
        skills: [
          { name: 'alpha', directoryPath: first },
          { name: 'alpha', directoryPath: second }
        ],
        bundleName: 'alpha',
        archivePath: join(root, 'x.tar.gz')
      })
    ).rejects.toThrow('skill-bundle-skill-collision')
  })

  it('rejects a file that is not a bundle', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'not-a-bundle.tar.gz')
    await writeFile(path, 'this is plain text')
    await expect(inspectSkillBundleFile(path)).rejects.toMatchObject({ code: 'file-invalid' })
  })

  it('rejects a file over the 40 MB limit without reading it', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'huge.tar.gz')
    await writeFile(path, '')
    await truncate(path, 41 * 1024 * 1024)
    await expect(inspectSkillBundleFile(path)).rejects.toMatchObject({ code: 'file-too-large' })
  })

  it('rejects a bundle whose bytes were changed after export', async () => {
    const root = await temporaryDirectory()
    const alpha = await createSkill(join(root, 'src'), 'alpha', 'x'.repeat(2000))
    const archivePath = join(root, 'alpha.tar.gz')
    await exportSkillBundle({
      skills: [{ name: 'alpha', directoryPath: alpha }],
      bundleName: 'alpha',
      archivePath
    })
    const bytes = await readFile(archivePath)
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    await writeFile(archivePath, bytes)
    await expect(inspectSkillBundleFile(archivePath)).rejects.toMatchObject({
      code: 'file-invalid'
    })
  })

  it('rejects a bundle whose manifest points outside the skill folder', async () => {
    const root = await temporaryDirectory()
    const alpha = await createSkill(join(root, 'src'), 'alpha')
    const good = join(root, 'good.tar.gz')
    const created = await (async () => {
      await exportSkillBundle({
        skills: [{ name: 'alpha', directoryPath: alpha }],
        bundleName: 'alpha',
        archivePath: good
      })
      return inspectSkillBundleFile(good)
    })()
    const manifest = structuredClone(created.version.manifest) as {
      skills: { files: { path: string }[] }[]
    }
    manifest.skills[0].files[0].path = '../evil.txt'
    const plugin = Buffer.from(
      JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
        name: 'alpha',
        version: created.version.versionId,
        description: ''
      })
    )
    const manifestBytes = Buffer.from(JSON.stringify(manifest))
    const evil = Buffer.from('owned')
    const evilPath = join(root, 'evil.tar.gz')
    await writeSkillTarGzip(evilPath, [
      { path: AGENT_PLUGIN_MANIFEST_PATH, size: plugin.length, executable: false, bytes: plugin },
      {
        path: ORCA_SKILL_BUNDLE_MANIFEST_PATH,
        size: manifestBytes.length,
        executable: false,
        bytes: manifestBytes
      },
      { path: 'skills/alpha/../evil.txt', size: evil.length, executable: false, bytes: evil }
    ])

    await expect(inspectSkillBundleFile(evilPath)).rejects.toMatchObject({ code: 'file-invalid' })
    await expect(stat(join(root, 'evil.txt'))).rejects.toThrow()
  })
})
