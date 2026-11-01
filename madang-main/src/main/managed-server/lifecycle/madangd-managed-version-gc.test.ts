import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServeReadiness } from '../../server/serve-readiness'
import { NODE_RUNTIME_ASSETS, NODE_RUNTIME_COMPAT_ASSETS } from '../../../shared/node-runtime-pin'

const { gcMock, readRecordMock } = vi.hoisted(() => ({
  gcMock: vi.fn(),
  readRecordMock: vi.fn()
}))

vi.mock('../install/madangd-remote-gc', () => ({ gcOldMadangdVersions: gcMock }))
vi.mock('../activation/madangd-activation-record-store', () => ({
  readMadangdActivationRecord: readRecordMock
}))

import { provenLiveDaemonVersion, pruneManagedMadangdVersions } from './madangd-managed-version-gc'
import { unusedMadangdHostTransport } from '../../ssh/unused-host-transport.test-fixture'

function readiness(terminalDaemon: unknown): ServeReadiness {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only health.terminalDaemon is read.
  return { health: terminalDaemon === undefined ? undefined : { terminalDaemon } } as ServeReadiness
}

const slot = {
  conn: unusedMadangdHostTransport(),
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: GC is mocked; the slot's host is only passed through.
  host: { os: 'linux', pathFlavor: 'posix', commandDialect: 'posix' } as never,
  remoteHome: '/home/u',
  nodePath: 'node',
  userDataDir: '/home/u/.madang',
  bindHost: '127.0.0.1',
  port: 0
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('managed madangd version GC after a deploy', () => {
  it('pins only a daemon version the readiness proves', () => {
    expect(provenLiveDaemonVersion(readiness({ state: 'live', buildVersion: '1.0.0+a' }))).toBe(
      '1.0.0+a'
    )
    expect(provenLiveDaemonVersion(readiness({ state: 'absent', buildVersion: null }))).toBeNull()
    expect(
      provenLiveDaemonVersion(readiness({ state: 'degraded', buildVersion: '1' }))
    ).toBeUndefined()
    expect(
      provenLiveDaemonVersion(readiness({ state: 'live', buildVersion: null }))
    ).toBeUndefined()
    expect(provenLiveDaemonVersion(readiness(undefined))).toBeUndefined()
  })

  it('runs GC with the live daemon pinned, and keeps everything when it cannot say', async () => {
    readRecordMock.mockResolvedValue({ active: '2.0.0+b' })
    await pruneManagedMadangdVersions({
      slot,
      serverTarget: 'linux-x64-glibc',
      activeVersion: '2.0.0+b',
      readiness: readiness({ state: 'live', buildVersion: '1.0.0+a' })
    })
    expect(gcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        liveDaemonVersion: '1.0.0+a',
        record: { active: '2.0.0+b' },
        // Default and compat builds share the runtime store; preserve both pins.
        nodeRuntimePins: [
          NODE_RUNTIME_ASSETS['linux-x64-glibc'].executableSha256,
          NODE_RUNTIME_COMPAT_ASSETS['linux-x64-glibc217'].executableSha256
        ]
      })
    )

    gcMock.mockClear()
    await pruneManagedMadangdVersions({
      slot,
      serverTarget: 'linux-x64-glibc',
      activeVersion: '2.0.0+b',
      readiness: readiness({ state: 'degraded', buildVersion: null })
    })
    expect(gcMock).not.toHaveBeenCalled()
  })

  it('never fails the deploy it follows', async () => {
    readRecordMock.mockResolvedValue({ active: '2.0.0+b' })
    gcMock.mockRejectedValue(new Error('ssh dropped'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(
      pruneManagedMadangdVersions({
        slot,
        serverTarget: 'linux-x64-glibc',
        activeVersion: '2.0.0+b',
        readiness: readiness({ state: 'absent', buildVersion: null })
      })
    ).resolves.toBeUndefined()
  })
})
