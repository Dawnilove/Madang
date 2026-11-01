import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { GithubSkillSource } from '../../shared/skill-github-url'
import { SkillImportError } from './skill-import-error'

const gunzipAsync = promisify(gunzip)

/** Hosts a GitHub download may touch, redirects included. */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'codeload.github.com',
  'api.github.com'
])
export const GITHUB_MAX_COMPRESSED_BYTES = 40 * 1024 * 1024
export const GITHUB_MAX_EXPANDED_BYTES = 64 * 1024 * 1024
const MAX_REDIRECTS = 3
const MAX_ENTRIES = 20_000
const TIMEOUT_MS = 60_000
const BLOCK = 512

export type TarFile = { path: string; data: Buffer; executable: boolean }

function allowedUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !ALLOWED_HOSTS.has(url.hostname)
  ) {
    throw new SkillImportError('network')
  }
  return url
}

async function fetchAllowed(start: URL, fetcher: typeof fetch, signal: AbortSignal) {
  let url = start
  for (let hop = 0; ; hop += 1) {
    const response = await fetcher(url, { redirect: 'manual', signal, headers: { accept: '*/*' } })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response
    }
    await response.body?.cancel().catch(() => undefined)
    const location = response.headers.get('location')
    if (!location || hop >= MAX_REDIRECTS) {
      throw new SkillImportError('network')
    }
    url = allowedUrl(new URL(location, url).href)
  }
}

async function readCapped(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > GITHUB_MAX_COMPRESSED_BYTES || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    throw new SkillImportError(response.body ? 'too-large' : 'network')
  }
  const chunks: Buffer[] = []
  let total = 0
  const reader = response.body.getReader()
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) {
      return Buffer.concat(chunks)
    }
    total += chunk.value.byteLength
    if (total > GITHUB_MAX_COMPRESSED_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new SkillImportError('too-large')
    }
    chunks.push(Buffer.from(chunk.value))
  }
}

/** Downloads the repository as a gzip tar from GitHub's code download host. */
export async function downloadGithubTarball(
  source: GithubSkillSource,
  fetcher: typeof fetch = fetch
): Promise<Buffer> {
  const ref = encodeURIComponent(source.ref ?? 'HEAD')
  const start = allowedUrl(
    `https://codeload.github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/tar.gz/${ref}`
  )
  let response: Response
  try {
    response = await fetchAllowed(start, fetcher, AbortSignal.timeout(TIMEOUT_MS))
  } catch (error) {
    throw error instanceof SkillImportError ? error : new SkillImportError('network')
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined)
    throw new SkillImportError('not-found')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new SkillImportError('network')
  }
  try {
    return await readCapped(response)
  } catch (error) {
    throw error instanceof SkillImportError ? error : new SkillImportError('network')
  }
}

function field(header: Buffer, offset: number, length: number): string {
  const end = header.indexOf(0, offset)
  return header
    .subarray(offset, end === -1 || end > offset + length ? offset + length : end)
    .toString('utf8')
}

function octal(header: Buffer, offset: number, length: number): number {
  const text = field(header, offset, length).trim()
  if (!/^[0-7]+$/.test(text)) {
    throw new SkillImportError('unsafe')
  }
  return Number.parseInt(text, 8)
}

function paxPath(body: Buffer): string | null {
  let position = 0
  while (position < body.length) {
    const space = body.indexOf(0x20, position)
    const length = Number(body.subarray(position, space).toString('utf8'))
    if (space === -1 || !Number.isInteger(length) || length <= space - position) {
      throw new SkillImportError('unsafe')
    }
    const record = body.subarray(space + 1, position + length - 1).toString('utf8')
    if (record.startsWith('path=')) {
      return record.slice(5)
    }
    position += length
  }
  return null
}

/**
 * Reads regular files from a tar held in memory. Links, directories and devices are skipped,
 * so nothing here can point outside the files that are returned.
 */
export function readTarFiles(tar: Buffer): TarFile[] {
  const files: TarFile[] = []
  let override: string | null = null
  let offset = 0
  for (let entries = 0; offset + BLOCK <= tar.length; entries += 1) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) {
      break
    }
    if (entries >= MAX_ENTRIES) {
      throw new SkillImportError('too-large')
    }
    const copy = Buffer.from(header)
    copy.fill(0x20, 148, 156)
    if (copy.reduce((sum, byte) => sum + byte, 0) !== octal(header, 148, 8)) {
      throw new SkillImportError('unsafe')
    }
    const size = octal(header, 124, 12)
    const bodyStart = offset + BLOCK
    if (bodyStart + size > tar.length) {
      throw new SkillImportError('unsafe')
    }
    const body = tar.subarray(bodyStart, bodyStart + size)
    offset = bodyStart + Math.ceil(size / BLOCK) * BLOCK
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    if (type === 'x') {
      override = paxPath(body) ?? override
    } else if (type === 'L') {
      override = body.toString('utf8').replace(/\0.*$/s, '')
    } else if (type === '0') {
      const prefix = field(header, 345, 155)
      const name = field(header, 0, 100)
      files.push({
        path: override ?? (prefix ? `${prefix}/${name}` : name),
        data: Buffer.from(body),
        executable: (octal(header, 100, 8) & 0o111) !== 0
      })
      override = null
    } else if (type !== 'g') {
      override = null
    }
  }
  return files
}

export async function expandGithubTarball(compressed: Buffer): Promise<TarFile[]> {
  let tar: Buffer
  try {
    tar = await gunzipAsync(compressed, { maxOutputLength: GITHUB_MAX_EXPANDED_BYTES })
  } catch (error) {
    throw new SkillImportError(
      (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' ? 'too-large' : 'unsafe'
    )
  }
  return readTarFiles(tar)
}
