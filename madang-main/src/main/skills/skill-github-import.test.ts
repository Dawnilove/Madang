import { stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseGithubSkillUrl } from '../../shared/skill-github-url'
import { importSkillsFromGithub } from './skill-github-import'
import { readTarFiles } from './skill-github-tarball'

type TarEntry = { path: string; content?: string; type?: string; mode?: number }

function header(path: string, size: number, type: string, mode: number): Buffer {
  const block = Buffer.alloc(512)
  block.write(path, 0, 'utf8')
  block.write(`${mode.toString(8).padStart(7, '0')}\0`, 100)
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  block.fill(0x20, 148, 156)
  block.write(type, 156)
  block.write('ustar\0', 257)
  block.write('00', 263)
  const sum = block.reduce((total, byte) => total + byte, 0)
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return block
}

function tar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const entry of entries) {
    const body = Buffer.from(entry.content ?? '')
    parts.push(header(entry.path, body.length, entry.type ?? '0', entry.mode ?? 0o644))
    parts.push(body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

const skillMd = (name: string): string =>
  `---\nname: ${name}\ndescription: ${name} description\n---\n\n# ${name}\n`

function repoTar(extra: TarEntry[] = []): Buffer {
  return gzipSync(
    tar([
      { path: 'owner-repo-abc/', type: '5' },
      { path: 'owner-repo-abc/README.md', content: 'readme' },
      { path: 'owner-repo-abc/skills/alpha/SKILL.md', content: skillMd('alpha') },
      { path: 'owner-repo-abc/skills/alpha/run.sh', content: '#!/bin/sh\n', mode: 0o755 },
      { path: 'owner-repo-abc/skills/beta/SKILL.md', content: skillMd('beta') },
      { path: 'owner-repo-abc/skills/beta/nested/SKILL.md', content: skillMd('nested') },
      { path: 'owner-repo-abc/skills/broken/SKILL.md', content: 'no frontmatter' },
      ...extra
    ])
  )
}

function respond(body: Buffer, init: ResponseInit = {}): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { 'content-type': 'application/gzip' },
    ...init
  })
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function run(url: string, fetcher: typeof fetch) {
  const source = parseGithubSkillUrl(url)
  if (!source) {
    throw new Error('test url must parse')
  }
  const imported = await importSkillsFromGithub(source, fetcher)
  cleanups.push(imported.cleanup)
  return imported
}

function skillNames(manifest: unknown): string[] {
  return (manifest as { skills: { name: string }[] }).skills.map((skill) => skill.name)
}

describe('GitHub skill import', () => {
  it('packs every SKILL.md folder of a repository into a bundle', async () => {
    const urls: string[] = []
    const fetcher = vi.fn(async (input: URL | string) => {
      urls.push(String(input))
      return respond(repoTar())
    }) as unknown as typeof fetch

    const imported = await run('https://github.com/owner/repo', fetcher)

    expect(urls).toEqual(['https://codeload.github.com/owner/repo/tar.gz/HEAD'])
    expect(skillNames(imported.version.manifest)).toEqual(['alpha', 'beta'])
    // The folder with an unreadable SKILL.md is reported, and the nested SKILL.md stays inside beta.
    expect(imported.skippedCount).toBe(1)
    const bundle = imported.version.manifest as { skills: { files: { path: string }[] }[] }
    expect(bundle.skills[1].files.map((file) => file.path)).toContain('nested/SKILL.md')
    await expect(stat(imported.archivePath)).resolves.toBeTruthy()
    await imported.cleanup()
    await expect(stat(imported.archivePath)).rejects.toThrow()
  })

  it('keeps the executable bit and limits the import to a folder from a tree address', async () => {
    const fetcher = vi.fn(async () => respond(repoTar())) as unknown as typeof fetch
    const imported = await run('https://github.com/owner/repo/tree/main/skills/alpha', fetcher)
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://codeload.github.com/owner/repo/tar.gz/main' }),
      expect.anything()
    )
    expect(skillNames(imported.version.manifest)).toEqual(['alpha'])
    const files = (imported.version.manifest as { skills: { files: object[] }[] }).skills[0].files
    expect(files).toContainEqual(expect.objectContaining({ path: 'run.sh', executable: true }))
  })

  it('reports a repository without skills', async () => {
    const fetcher = (async () =>
      respond(gzipSync(tar([{ path: 'r/README.md', content: 'x' }])))) as unknown as typeof fetch
    await expect(run('https://github.com/owner/repo', fetcher)).rejects.toMatchObject({
      code: 'no-skills'
    })
  })

  it('reports a missing repository', async () => {
    const fetcher = (async () =>
      new Response('Not Found', { status: 404 })) as unknown as typeof fetch
    await expect(run('https://github.com/owner/missing', fetcher)).rejects.toMatchObject({
      code: 'not-found'
    })
  })

  it('refuses archive entries that climb out of their folder', async () => {
    const fetcher = (async () =>
      respond(
        repoTar([{ path: 'owner-repo-abc/skills/../../../evil.txt', content: 'x' }])
      )) as unknown as typeof fetch
    await expect(run('https://github.com/owner/repo', fetcher)).rejects.toMatchObject({
      code: 'unsafe'
    })
  })

  it('refuses absolute archive entries', async () => {
    const fetcher = (async () =>
      respond(repoTar([{ path: '/etc/passwd', content: 'x' }]))) as unknown as typeof fetch
    await expect(run('https://github.com/owner/repo', fetcher)).rejects.toMatchObject({
      code: 'unsafe'
    })
  })

  it('never writes links from the archive', async () => {
    const files = readTarFiles(
      tar([
        { path: 'r/skills/a/SKILL.md', content: skillMd('a') },
        { path: 'r/skills/a/link', type: '2' },
        { path: 'r/skills/a/hard', type: '1' }
      ])
    )
    expect(files.map((file) => file.path)).toEqual(['r/skills/a/SKILL.md'])
  })

  it('reads long paths from pax headers', () => {
    const longPath = `r/${'d/'.repeat(60)}SKILL.md`
    const record = ` path=${longPath}\n`
    const length = record.length + String(record.length + 3).length
    const pax = `${length} path=${longPath}\n`
    const files = readTarFiles(
      tar([
        { path: 'pax_header', type: 'x', content: pax },
        { path: 'short-name', content: 'x' }
      ])
    )
    expect(files.map((file) => file.path)).toEqual([longPath])
  })

  it('follows a redirect inside the allowed hosts only', async () => {
    const seen: string[] = []
    const fetcher = vi.fn(async (input: URL | string) => {
      seen.push(String(input))
      return seen.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://codeload.github.com/owner/repo/tar.gz/refs/heads/main' }
          })
        : respond(repoTar())
    }) as unknown as typeof fetch
    await run('https://github.com/owner/repo', fetcher)
    expect(seen).toEqual([
      'https://codeload.github.com/owner/repo/tar.gz/HEAD',
      'https://codeload.github.com/owner/repo/tar.gz/refs/heads/main'
    ])
  })

  it.each([
    'https://evil.example/owner/repo.tar.gz',
    'http://codeload.github.com/owner/repo.tar.gz',
    'https://github.com.evil.example/x',
    'https://user:pw@codeload.github.com/x'
  ])('does not follow a redirect to %s', async (location) => {
    const calls: string[] = []
    const fetcher = vi.fn(async (input: URL | string) => {
      calls.push(String(input))
      return new Response(null, { status: 302, headers: { location } })
    }) as unknown as typeof fetch
    await expect(run('https://github.com/owner/repo', fetcher)).rejects.toMatchObject({
      code: 'network'
    })
    expect(calls).toHaveLength(1)
  })

  it('stops a download that is declared larger than the limit', async () => {
    const fetcher = (async () =>
      respond(repoTar(), {
        headers: { 'content-length': String(41 * 1024 * 1024) }
      })) as unknown as typeof fetch
    await expect(run('https://github.com/owner/repo', fetcher)).rejects.toMatchObject({
      code: 'too-large'
    })
  })

  it('stops an archive that expands past the limit', async () => {
    const bomb = gzipSync(Buffer.alloc(65 * 1024 * 1024))
    const fetcher = (async () => respond(bomb)) as unknown as typeof fetch
    await expect(run('https://github.com/owner/repo', fetcher)).rejects.toMatchObject({
      code: 'too-large'
    })
  })
})
