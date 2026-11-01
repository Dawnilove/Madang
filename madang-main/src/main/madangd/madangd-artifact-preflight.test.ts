import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MADANGD_MOBILE_WEB_MANIFEST, madangdArtifactFilenames } from '../../shared/madangd-artifacts'
import { runMadangdProfilePreflight } from './madangd-profile-preflight'
import { readMadangdArtifactIdentity } from './madangd-artifact-identity'
import { resolveMadangdExitCode } from './madangd-exit-code'
import type * as BundledRuntime from './madangd-bundled-runtime'

const fixture = vi.hoisted(() => ({
  directory: '',
  sqlite: vi.fn(async () => ({ sqliteVersion: '3.53.2', revision: 1 }))
}))
vi.mock('./madangd-app-paths', () => ({ resolveMadangdInstallRoot: () => fixture.directory }))
vi.mock('../persistence/profile-state/profile-state-runtime-preflight', () => ({
  preflightProfileStateRuntime: fixture.sqlite
}))
vi.mock('./madangd-runtime-native-preflight', () => ({
  preflightMadangdNativeRuntime: vi.fn(async () => {})
}))
vi.mock('./madangd-bundled-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof BundledRuntime>()),
  isRunningAsBundledMadangdRuntime: () => false
}))

function fixtureContents(filename: string): string {
  if (filename === '.server-target') {
    return 'linux-x64-glibc\n'
  }
  return filename === MADANGD_MOBILE_WEB_MANIFEST
    ? JSON.stringify({ assets: [{ path: 'index.html' }] })
    : filename
}

beforeEach(async () => {
  fixture.directory = await mkdtemp(join(tmpdir(), 'madangd-artifact-preflight-'))
  for (const filename of madangdArtifactFilenames('linux-x64-glibc', ['out/mobile-web/index.html'])) {
    const path = join(fixture.directory, filename)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, fixtureContents(filename))
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await rm(fixture.directory, { recursive: true, force: true })
})

describe('installed artifact admission', () => {
  it('qualifies build output before its version marker is published', async () => {
    await runMadangdProfilePreflight(randomUUID())
    expect(fixture.sqlite).toHaveBeenCalledOnce()
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(await readMadangdArtifactIdentity(fixture.directory))
    )
  })

  it.each([
    '.server-target',
    'node_modules/@parcel/watcher/watcher.node',
    '.runtime-node',
    'node_modules/node-pty/build/Release/pty.node',
    'out/mobile-web/index.html'
  ])('refuses a missing %s as configuration before any profile probe', async (filename) => {
    await rm(join(fixture.directory, filename))
    const error = await runMadangdProfilePreflight(randomUUID()).catch((failure: unknown) => failure)
    expect(resolveMadangdExitCode(error)).toBe(78)
    expect(fixture.sqlite).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  it('refuses a malformed target even though all named files exist', async () => {
    await writeFile(join(fixture.directory, '.server-target'), 'not-a-runtime-target')
    const error = await runMadangdProfilePreflight(randomUUID()).catch((failure: unknown) => failure)
    expect(resolveMadangdExitCode(error)).toBe(78)
    expect(fixture.sqlite).not.toHaveBeenCalled()
  })
})
