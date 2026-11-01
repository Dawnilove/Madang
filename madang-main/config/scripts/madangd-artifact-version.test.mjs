import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MADANGD_MOBILE_WEB_MANIFEST,
  MADANGD_NODE_RUNTIME_MARKER_FILENAME,
  MADANGD_SERVER_TARGET_FILENAME,
  madangdArtifactFilenames,
  madangdRipgrepArtifact
} from '../../src/shared/madangd-artifacts.ts'
import { SERVER_TARGETS } from '../../src/shared/node-runtime-pin.ts'
import { madangdAgentBrowserNativeName } from '../../src/shared/madangd-agent-browser-name.ts'
import { readMadangdArtifactIdentity } from '../../src/main/madangd/madangd-artifact-identity.ts'
import { computeMadangdFullVersion } from './madangd-artifact-version.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const PAGE_ASSET = 'out/mobile-web/index.html'
const PAGE_MANIFEST = JSON.stringify({ assets: [{ path: 'index.html' }] })

function createArtifactDirectory(target = 'linux-x64-glibc') {
  const directory = mkdtempSync(join(tmpdir(), 'madangd-version-'))
  directories.push(directory)
  for (const filename of madangdArtifactFilenames(target, [PAGE_ASSET])) {
    const path = join(directory, filename)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, filename === MADANGD_MOBILE_WEB_MANIFEST ? PAGE_MANIFEST : filename)
  }
  writeFileSync(join(directory, MADANGD_SERVER_TARGET_FILENAME), `${target}\n`)
  return directory
}

describe('standalone runtime version', () => {
  it('changes when a shipped search binary changes and rejects a missing binary', () => {
    const target = 'linux-x64-glibc'
    const dir = createArtifactDirectory(target)
    const before = computeMadangdFullVersion(dir, { target })
    const binary = join(dir, madangdRipgrepArtifact(target))
    writeFileSync(binary, 'updated binary')
    expect(computeMadangdFullVersion(dir, { target })).not.toBe(before)
    rmSync(binary)
    expect(() => computeMadangdFullVersion(dir, { target })).toThrow(madangdRipgrepArtifact(target))
  })

  it('changes when a page asset changes and rejects a missing one', () => {
    const target = 'linux-x64-glibc'
    const dir = createArtifactDirectory(target)
    const before = computeMadangdFullVersion(dir, { target })
    writeFileSync(join(dir, PAGE_ASSET), 'updated page')
    expect(computeMadangdFullVersion(dir, { target })).not.toBe(before)
    rmSync(join(dir, PAGE_ASSET))
    expect(() => computeMadangdFullVersion(dir, { target })).toThrow(PAGE_ASSET)
  })

  it('keys the version on the referenced runtime digest rather than its bytes', () => {
    const target = 'darwin-arm64'
    const dir = createArtifactDirectory(target)
    writeFileSync(join(dir, MADANGD_NODE_RUNTIME_MARKER_FILENAME), `${'a'.repeat(64)}\n`)
    const before = computeMadangdFullVersion(dir, { target })
    writeFileSync(join(dir, MADANGD_NODE_RUNTIME_MARKER_FILENAME), `${'b'.repeat(64)}\n`)
    expect(computeMadangdFullVersion(dir, { target })).not.toBe(before)
  })

  it.each(SERVER_TARGETS)(
    'matches the installed %s identity with and without its optional browser',
    async (target) => {
      const dir = createArtifactDirectory(target)
      const [platform, arch] = target.split('-')
      const agentBrowserFilename = madangdAgentBrowserNativeName(
        platform,
        arch,
        target.endsWith('-musl') ? 'musl' : 'glibc'
      )
      const options = { target, agentBrowserFilename }
      const withoutBrowser = computeMadangdFullVersion(dir, options)
      expect(withoutBrowser).toBe(await readMadangdArtifactIdentity(dir))
      writeFileSync(join(dir, agentBrowserFilename), 'browser')
      const withBrowser = computeMadangdFullVersion(dir, options)
      expect(withBrowser).not.toBe(withoutBrowser)
      expect(withBrowser).toBe(await readMadangdArtifactIdentity(dir))
      writeFileSync(join(dir, agentBrowserFilename), 'updated-browser')
      expect(computeMadangdFullVersion(dir, options)).not.toBe(withBrowser)
      expect(computeMadangdFullVersion(dir, options)).toBe(await readMadangdArtifactIdentity(dir))
    }
  )
})
