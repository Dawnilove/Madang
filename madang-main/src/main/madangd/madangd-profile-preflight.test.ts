import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProcessResult, ProcessSpec } from '@orca/process-host/process-spec'
import { NODE_RUNTIME_PIN } from '../../shared/node-runtime-pin'
import { MADANGD_STARTUP_PREFLIGHT_FLAG } from '../../shared/madangd-profile-preflight'
import { MadangdBundledRuntimeError } from './madangd-bundled-runtime'
import type * as BundledRuntime from './madangd-bundled-runtime'
import { resolveMadangdExitCode } from './madangd-exit-code'
import { preflightBundledMadangdStartup, runMadangdProfilePreflight } from './madangd-profile-preflight'

const fixture = vi.hoisted(() => ({
  identity: vi.fn(),
  readVersion: vi.fn(),
  sql: vi.fn(),
  native: vi.fn(),
  bundled: vi.fn<(directory: string) => boolean>(),
  run: vi.fn<(spec: ProcessSpec) => Promise<ProcessResult>>()
}))
vi.mock('./madangd-bundled-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof BundledRuntime>()),
  isRunningAsBundledMadangdRuntime: fixture.bundled,
  resolveBundledMadangdSlot: () => '/slot'
}))
vi.mock('./madangd-artifact-identity', () => ({ readMadangdArtifactIdentity: fixture.identity }))
vi.mock('node:fs/promises', () => ({ readFile: fixture.readVersion }))
vi.mock('../persistence/profile-state/profile-state-runtime-preflight', () => ({
  preflightProfileStateRuntime: fixture.sql
}))
vi.mock('./madangd-runtime-native-preflight', () => ({
  preflightMadangdNativeRuntime: fixture.native
}))
vi.mock('@orca/process-host', () => ({ runProcess: fixture.run }))

const identity = '0.1.0+aaaaaaaaaaaa'
const nonce = '743bf9c8-2e58-4c79-a0ac-52c8d3e8e103'

function readyResult(challenge: string | undefined): ProcessResult {
  return {
    code: 0,
    signal: null,
    timedOut: false,
    stderr: '',
    stdout: JSON.stringify({
      type: 'orca_profile_state_ready',
      nonce: challenge,
      runtime: 'node',
      runtimeVersion: NODE_RUNTIME_PIN.version,
      artifactVersion: identity,
      sqliteVersion: '3.53.2',
      revision: 1
    })
  }
}

beforeEach(() => {
  vi.spyOn(process, 'versions', 'get').mockReturnValue({
    ...process.versions,
    node: NODE_RUNTIME_PIN.version
  })
  fixture.bundled.mockReturnValue(true)
  fixture.identity.mockResolvedValue(identity)
  fixture.readVersion.mockResolvedValue(`${identity}\n`)
  fixture.sql.mockResolvedValue({ sqliteVersion: '3.53.2', revision: 1 })
  fixture.native.mockResolvedValue(undefined)
  fixture.run.mockImplementation(async (spec) => readyResult(spec.args?.[2]))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('bundled Madang startup readiness', () => {
  it.each(['win32', 'darwin', 'linux'] as const)(
    'isolates native process state in the exact bundled %s executable',
    async (platform) => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
      await preflightBundledMadangdStartup()
      expect(fixture.bundled).toHaveBeenCalledWith('/slot')
      expect(fixture.run).toHaveBeenCalledOnce()
      expect(fixture.run).toHaveBeenCalledWith({
        program: process.execPath,
        args: [join('/slot', 'madangd-server.js'), MADANGD_STARTUP_PREFLIGHT_FLAG, expect.any(String)],
        env: expect.objectContaining({ MADANG_BACKGROUND_LAUNCH: '1' }),
        timeoutMs: 90_000,
        maxOutputBytes: 64 * 1024,
        terminationBarrier: true
      })
      expect(fixture.sql).not.toHaveBeenCalled()
      expect(fixture.native).not.toHaveBeenCalled()
    }
  )

  it('leaves an unpackaged or host-Node start on its existing readiness path', async () => {
    fixture.bundled.mockReturnValue(false)
    await preflightBundledMadangdStartup()
    expect(fixture.identity).not.toHaveBeenCalled()
    expect(fixture.run).not.toHaveBeenCalled()
  })

  it('hashes installed bytes only in the isolated child', async () => {
    await preflightBundledMadangdStartup()
    expect(fixture.identity).not.toHaveBeenCalled()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await runMadangdProfilePreflight(nonce, { nativeFeatures: false })
    expect(fixture.identity).toHaveBeenCalledOnce()
  })

  it.each(['missing artifact', 'corrupt build target'])(
    'classifies %s as a configuration fault before testing SQLite',
    async (message) => {
      fixture.identity.mockRejectedValue(new Error(message))
      const failure = await runMadangdProfilePreflight(nonce).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MadangdBundledRuntimeError)
      expect(resolveMadangdExitCode(failure)).toBe(78)
      expect(fixture.sql).not.toHaveBeenCalled()
    }
  )

  it('classifies changed artifact bytes as configuration faults on normal startup', async () => {
    fixture.readVersion.mockResolvedValue('0.1.0+bbbbbbbbbbbb')
    await expect(preflightBundledMadangdStartup()).rejects.toThrow(MadangdBundledRuntimeError)
  })

  it.each([undefined, 'broken-version'])(
    'classifies an unreadable or malformed version marker as configuration: %s',
    async (version) => {
      if (version === undefined) {
        fixture.readVersion.mockRejectedValue(new Error('ENOENT'))
      } else {
        fixture.readVersion.mockResolvedValue(version)
      }
      await expect(preflightBundledMadangdStartup()).rejects.toThrow(MadangdBundledRuntimeError)
      expect(fixture.run).not.toHaveBeenCalled()
    }
  )

  it('awaits probe termination before permitting server startup', async () => {
    const exit = Promise.withResolvers<ProcessResult>()
    fixture.run.mockReturnValue(exit.promise)
    let admitted = false
    const startup = preflightBundledMadangdStartup().then(() => {
      admitted = true
    })
    await vi.waitFor(() => expect(fixture.run).toHaveBeenCalledOnce())
    expect(admitted).toBe(false)
    exit.resolve(readyResult(fixture.run.mock.calls[0]?.[0].args?.[2]))
    await startup
    expect(admitted).toBe(true)
  })

  it.each([{ code: 78 }, { timedOut: true }, { outputTruncated: true }])(
    'refuses a failed child even if it emitted a valid readiness reply: %j',
    async (failure) => {
      fixture.run.mockImplementation(async (spec) => ({
        ...readyResult(spec.args?.[2]),
        ...failure,
        stderr: 'native probe failed'
      }))
      await expect(preflightBundledMadangdStartup()).rejects.toThrow('native probe failed')
    }
  )

  it('preserves configuration exit status from the isolated child', async () => {
    fixture.run.mockImplementation(async (spec) => ({ ...readyResult(spec.args?.[2]), code: 78 }))
    const failure = await preflightBundledMadangdStartup().catch((error: unknown) => error)
    expect(resolveMadangdExitCode(failure)).toBe(78)
  })

  it('keeps transient SQLite readiness failures retryable', async () => {
    fixture.sql.mockRejectedValue(new Error('SQLITE_BUSY'))
    const failure = await runMadangdProfilePreflight(nonce).catch((error: unknown) => error)
    expect(resolveMadangdExitCode(failure)).toBe(1)
  })

  it('leaves optional native probes to runtime health on normal startup', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await runMadangdProfilePreflight(nonce, { nativeFeatures: false })
    expect(fixture.sql).toHaveBeenCalledOnce()
    expect(fixture.native).toHaveBeenCalledWith({ nativeFeatures: false })
  })

  it('rejects stale output from a different challenge', async () => {
    fixture.run.mockResolvedValue(readyResult(nonce))
    await expect(preflightBundledMadangdStartup()).rejects.toThrow('invalid readiness identity')
  })

  it('rechecks the child artifact identity against the verified installed version', async () => {
    fixture.run.mockImplementation(async (spec) => {
      const result = readyResult(spec.args?.[2])
      return { ...result, stdout: result.stdout.replace(identity, '0.1.0+bbbbbbbbbbbb') }
    })
    await expect(preflightBundledMadangdStartup()).rejects.toThrow('invalid readiness identity')
  })

  it('runs disposable probes directly in the command child without recursive spawning', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runMadangdProfilePreflight(nonce)
    expect(fixture.sql).toHaveBeenCalledOnce()
    expect(fixture.native).toHaveBeenCalledOnce()
    expect(fixture.run).not.toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith(readyResult(nonce).stdout)
  })
})
