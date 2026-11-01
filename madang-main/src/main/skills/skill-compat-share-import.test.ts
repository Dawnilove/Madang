import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ORCA_COMPAT_SKILL_DOWNLOAD_ORIGINS,
  ORCA_COMPAT_SKILL_SHARE_API_ORIGIN
} from '../../shared/skills/orca-compat-skill-share'
import { SKILL_PACKAGE_CONTENT_TYPE } from '../../shared/skill-package-manifest'
import { exportSkillBundle } from './skill-bundle-file-export'
import { inspectSkillBundleFile } from './skill-bundle-file-import'
import { importSkillsFromCompatShare } from './skill-compat-share-import'

const directories: string[] = []
const cleanups: (() => Promise<void>)[] = []
const STORAGE = ORCA_COMPAT_SKILL_DOWNLOAD_ORIGINS[0]

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'madang-compat-test-'))
  directories.push(root)
  const source = join(root, 'src', 'alpha')
  await mkdir(source, { recursive: true })
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: alpha\ndescription: alpha\n---\n\n# alpha\n'
  )
  const archivePath = join(root, 'alpha.tar.gz')
  await exportSkillBundle({
    skills: [{ name: 'alpha', directoryPath: source }],
    bundleName: 'alpha',
    archivePath
  })
  const { version } = await inspectSkillBundleFile(archivePath)
  const bytes = await readFile(archivePath)
  const wire = {
    packageId: version.packageId,
    versionId: version.versionId,
    archiveSha256: version.archiveSha256,
    compressedBytes: version.compressedBytes,
    manifest: version.manifest
  }
  return { root, bytes, wire }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

function fakeService(
  fx: Awaited<ReturnType<typeof fixture>>,
  overrides: { grantUrl?: string; share?: unknown; status?: number } = {}
) {
  const calls: { url: string; method: string }[] = []
  const fetcher = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url === `${ORCA_COMPAT_SKILL_SHARE_API_ORIGIN}/v1/skill-shares/share_1`) {
      return overrides.status
        ? new Response('gone', { status: overrides.status })
        : json(overrides.share ?? { share: { id: 'share_1', version: fx.wire } })
    }
    if (url === `${ORCA_COMPAT_SKILL_SHARE_API_ORIGIN}/v1/skill-shares/share_1/download-grants`) {
      return json({
        grant: {
          url: overrides.grantUrl ?? `${STORAGE}/bucket/package.tar.gz`,
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        },
        version: fx.wire
      })
    }
    if (url.startsWith(STORAGE)) {
      return new Response(new Uint8Array(fx.bytes), {
        headers: {
          'content-type': SKILL_PACKAGE_CONTENT_TYPE,
          'content-length': String(fx.bytes.length)
        }
      })
    }
    throw new Error(`unexpected request to ${url}`)
  }) as unknown as typeof fetch
  return { fetcher, calls }
}

describe('Orca-compatible skill share import', () => {
  it('reads the share, downloads the bundle from storage and returns what the archive holds', async () => {
    const fx = await fixture()
    const service = fakeService(fx)

    const imported = await importSkillsFromCompatShare('share_1', {
      temporaryRoot: join(fx.root, 'downloads'),
      fetcher: service.fetcher
    })
    cleanups.push(imported.cleanup)

    expect(service.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${ORCA_COMPAT_SKILL_SHARE_API_ORIGIN}/v1/skill-shares/share_1`,
      `POST ${ORCA_COMPAT_SKILL_SHARE_API_ORIGIN}/v1/skill-shares/share_1/download-grants`,
      `GET ${STORAGE}/bucket/package.tar.gz`
    ])
    expect(imported.version.name).toBe('alpha')
    await expect(stat(imported.archivePath)).resolves.toBeTruthy()
    await imported.cleanup()
    await expect(stat(imported.archivePath)).rejects.toThrow()
  })

  it('refuses a download address outside the storage allow list', async () => {
    const fx = await fixture()
    const service = fakeService(fx, { grantUrl: 'https://evil.example/package.tar.gz' })

    await expect(
      importSkillsFromCompatShare('share_1', {
        temporaryRoot: join(fx.root, 'downloads'),
        fetcher: service.fetcher
      })
    ).rejects.toMatchObject({ code: 'network' })
    expect(service.calls.some((call) => call.url.includes('evil.example'))).toBe(false)
  })

  it('refuses a plain http download address', async () => {
    const fx = await fixture()
    const service = fakeService(fx, { grantUrl: 'http://storage.googleapis.com/package.tar.gz' })
    await expect(
      importSkillsFromCompatShare('share_1', {
        temporaryRoot: join(fx.root, 'downloads'),
        fetcher: service.fetcher
      })
    ).rejects.toMatchObject({ code: 'network' })
    expect(service.calls).toHaveLength(2)
  })

  it('reports a share that does not exist', async () => {
    const fx = await fixture()
    const service = fakeService(fx, { status: 404 })
    await expect(
      importSkillsFromCompatShare('share_1', {
        temporaryRoot: join(fx.root, 'downloads'),
        fetcher: service.fetcher
      })
    ).rejects.toMatchObject({ code: 'not-found' })
    expect(service.calls).toHaveLength(1)
  })

  it('rejects a response that does not match the expected shape', async () => {
    const fx = await fixture()
    const service = fakeService(fx, {
      share: { share: { id: 'share_1', version: { oops: true } } }
    })
    await expect(
      importSkillsFromCompatShare('share_1', {
        temporaryRoot: join(fx.root, 'downloads'),
        fetcher: service.fetcher
      })
    ).rejects.toMatchObject({ code: 'network' })
    expect(service.calls).toHaveLength(1)
  })

  it('does not import the older single-skill format', async () => {
    const fx = await fixture()
    const single = { ...fx.wire, manifest: { schemaVersion: 1, name: 'alpha', files: [] } }
    const service = fakeService(fx, { share: { share: { id: 'share_1', version: single } } })
    await expect(
      importSkillsFromCompatShare('share_1', {
        temporaryRoot: join(fx.root, 'downloads'),
        fetcher: service.fetcher
      })
    ).rejects.toMatchObject({ code: 'unsupported-package' })
    expect(service.calls).toHaveLength(1)
  })

  it('rejects a download whose bytes differ from the share digest', async () => {
    const fx = await fixture()
    const service = fakeService({ ...fx, bytes: Buffer.from(fx.bytes).fill(0, 12, 40) })
    await expect(
      importSkillsFromCompatShare('share_1', {
        temporaryRoot: join(fx.root, 'downloads'),
        fetcher: service.fetcher
      })
    ).rejects.toMatchObject({ code: 'network' })
  })
})
