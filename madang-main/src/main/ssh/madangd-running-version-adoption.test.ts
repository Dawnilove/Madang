import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MadangdActivationRecord } from '../managed-server/activation/madangd-activation-record'
import type { MadangdSlotOptions } from './madangd-recovery-slot'
import { getRemoteHostPlatform } from './ssh-remote-platform'

const mocks = vi.hoisted(() => ({
  wake: vi.fn(),
  readRecord: vi.fn(),
  probe: vi.fn(),
  launch: vi.fn(),
  fenceRefusal: vi.fn()
}))

vi.mock('../managed-server/activation/madangd-activation-fence-hold', () => ({
  madangdActivationFenceRefusal: mocks.fenceRefusal
}))

vi.mock('../managed-server/lifecycle/madangd-managed-wake', () => ({
  wakeStoppedManagedMadangd: mocks.wake
}))
vi.mock('../managed-server/activation/madangd-activation-record-store', () => ({
  readMadangdActivationRecord: mocks.readRecord
}))
vi.mock('../managed-server/install/madangd-remote-build-hash', () => ({
  readRemoteMadangdBuildHash: async () => 'hash'
}))
vi.mock('./madangd-active-readiness', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeActiveMadangdReadiness: mocks.probe,
  launchMadangdSlotAndAwaitReadiness: mocks.launch
}))

const { adoptRunningMadangdVersion } = await import('./madangd-running-version-adoption')

const LOCAL = '1.5.0+new'
const RUNNING = '1.4.0+old'
const READINESS = { runtimeId: 'r' }

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every remote step is mocked, so only the paths are read.
const slot = {
  host: getRemoteHostPlatform('linux-x64'),
  remoteHome: '/home/u',
  userDataDir: '/home/u/.madang'
} as MadangdSlotOptions

const record = (active: string | null): MadangdActivationRecord => ({
  schemaVersion: 1,
  active,
  previous: null,
  activatedAt: null,
  snapshot: null
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.readRecord.mockResolvedValue(record(RUNNING))
  mocks.probe.mockResolvedValue(READINESS)
})

describe('adoptRunningMadangdVersion', () => {
  it('leaves an empty host, or one on this build, to the deploy', async () => {
    await expect(adoptRunningMadangdVersion(slot, record(null), LOCAL)).resolves.toBeNull()
    await expect(adoptRunningMadangdVersion(slot, record(LOCAL), LOCAL)).resolves.toBeNull()
    expect(mocks.wake).not.toHaveBeenCalled()
  })

  it('adopts the serving build, proven against its own installed bytes', async () => {
    mocks.wake.mockResolvedValue({ outcome: 'serving' })
    await expect(adoptRunningMadangdVersion(slot, record(RUNNING), LOCAL)).resolves.toMatchObject({
      version: RUNNING,
      readiness: READINESS
    })
    expect(mocks.probe).toHaveBeenCalledWith(
      expect.objectContaining({ remoteInstallDir: expect.stringContaining(RUNNING) }),
      { buildHash: 'hash', fullVersion: RUNNING }
    )
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('adopts a stopped build the wake restarted', async () => {
    mocks.wake.mockResolvedValue({ outcome: 'started', readiness: READINESS })
    await expect(adoptRunningMadangdVersion(slot, record(RUNNING), LOCAL)).resolves.toMatchObject({
      version: RUNNING
    })
  })

  it('defers to the deploy when the host was stopped, or moved to this build meanwhile', async () => {
    mocks.wake.mockResolvedValueOnce({ outcome: 'not-activated' })
    await expect(adoptRunningMadangdVersion(slot, record(RUNNING), LOCAL)).resolves.toBeNull()
    mocks.wake.mockResolvedValueOnce({ outcome: 'serving' })
    mocks.readRecord.mockResolvedValueOnce(record(LOCAL))
    await expect(adoptRunningMadangdVersion(slot, record(RUNNING), LOCAL)).resolves.toBeNull()
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  // #28833: peer startup must defer adoption; an unpaired deploy cannot census the running host.
  it('waits on a fence another run holds instead of deploying over an uncounted host', async () => {
    mocks.wake.mockResolvedValueOnce({ outcome: 'fenced' })
    mocks.fenceRefusal.mockResolvedValueOnce({
      code: 'madangd_activation_fence_busy',
      reason: 'busy'
    })
    await expect(adoptRunningMadangdVersion(slot, record(RUNNING), LOCAL)).resolves.toEqual({
      outcome: 'deferred',
      candidateVersion: LOCAL,
      code: 'madangd_activation_fence_busy',
      reason: 'busy',
      forceable: false
    })
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it('retries the wake once after clearing an abandoned fence', async () => {
    mocks.wake.mockResolvedValueOnce({ outcome: 'fenced' })
    mocks.fenceRefusal.mockResolvedValueOnce({ code: 'c', reason: 'cleared', cleared: true })
    mocks.wake.mockResolvedValueOnce({ outcome: 'started', readiness: READINESS })
    await expect(adoptRunningMadangdVersion(slot, record(RUNNING), LOCAL)).resolves.toMatchObject({
      version: RUNNING
    })
    mocks.wake.mockResolvedValue({ outcome: 'fenced' })
    mocks.fenceRefusal.mockResolvedValue({ code: 'c', reason: 'cleared', cleared: true })
    await expect(adoptRunningMadangdVersion(slot, record(RUNNING), LOCAL)).resolves.toMatchObject({
      outcome: 'deferred'
    })
    expect(mocks.wake).toHaveBeenCalledTimes(4)
  })

  it('reports an unverifiable or unrecoverable host without touching it', async () => {
    mocks.wake.mockResolvedValueOnce({ outcome: 'unverifiable' })
    await expect(adoptRunningMadangdVersion(slot, record(RUNNING), LOCAL)).rejects.toMatchObject({
      verdict: 'unverifiable'
    })
    mocks.wake.mockResolvedValueOnce({ outcome: 'recovery-refused', reason: 'Recover it first.' })
    await expect(adoptRunningMadangdVersion(slot, record(RUNNING), LOCAL)).rejects.toThrow(
      'Recover it first.'
    )
    expect(mocks.launch).not.toHaveBeenCalled()
  })
})
