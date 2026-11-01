import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRemoteHostPlatform, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  MADANGD_UPDATE_ADMISSION_FENCE_MS,
  MADANGD_UPDATE_ADMISSION_STOP_BY_MS
} from '../../../shared/madangd-terminal-census'

const mocks = vi.hoisted(() => {
  const host: { current: RemoteHostPlatform | null } = { current: null }
  const active: { current: string | null } = { current: '1.0.0' }
  return {
    census: vi.fn(),
    stop: vi.fn(),
    wake: vi.fn(),
    rebuild: vi.fn(async () => {}),
    exec: vi.fn(),
    retain: vi.fn(),
    host,
    active,
    lockBusy: { current: false }
  }
})

vi.mock('../../ssh/madangd-runtime-maintenance', () => ({
  withManagedMadangdLifecycle: (
    _path: string,
    _selector: string,
    run: (managed: unknown) => Promise<unknown>
  ) => run({ environment: { id: 'env-1' }, deployment: { remotePort: 7777 } })
}))
vi.mock('./madangd-managed-runtime-context', () => ({
  requireManagedMadangdEnvironment: () => ({
    environment: { id: 'env-1' },
    deployment: { remotePort: 7777 }
  }),
  resolveLinkedMadangdContext: async () => ({
    host: mocks.host.current,
    connection: {},
    remoteHome: '/Users/dev',
    activationRecord: { active: mocks.active.current }
  }),
  requireManagedMadangdInfrastructure: () => ({
    connectionManager: {
      getState: () => ({ status: 'connected' }),
      getConnection: () => ({})
    },
    targetStore: { getTarget: () => ({ id: 'ssh-1' }) }
  }),
  managedMadangdSlot: () => ({
    host: mocks.host.current,
    remoteHome: '/Users/dev',
    userDataDir: '/Users/dev/.madang'
  }),
  managedMadangdInstallDir: () => '/Users/dev/.madang-remote/madangd-1.0.0'
}))
vi.mock('../install/madangd-remote-context', () => ({
  resolveMadangdRemoteContext: async () => ({
    host: mocks.host.current,
    connection: {},
    remoteHome: '/Users/dev',
    userDataDir: '/Users/dev/.madang',
    activationRecord: { active: mocks.active.current }
  })
}))
vi.mock('../../ssh/madangd-ssh-host-transport', () => ({ sshMadangdHostTransport: (c: unknown) => c }))
vi.mock('../activation/madangd-activation-lock', () => ({
  withMadangdActivationLock: (
    _slot: unknown,
    run: (lock: unknown) => Promise<unknown>,
    busy: () => unknown
  ) => (mocks.lockBusy.current ? busy() : run({ retain: mocks.retain }))
}))
vi.mock('../activation/madangd-activation-record-store', () => ({
  readMadangdActivationRecord: async () => ({ active: mocks.active.current })
}))
vi.mock('./madangd-managed-remote-stop', () => ({
  readRemoteMadangdManagedStopTarget: async () => ({ state: 'ready', context: { version: '1.0.0' } })
}))
vi.mock('./madangd-rollback-terminal-barrier', () => ({
  stopIncumbentBehindTerminalBarrier: mocks.stop
}))
vi.mock('./madangd-managed-wake', () => ({ wakeStoppedManagedMadangd: mocks.wake }))
vi.mock('./madangd-managed-tunnel', () => ({ rebuildMadangdManagedTunnel: mocks.rebuild }))
vi.mock('../../ssh/madangd-terminal-census-client', () => ({
  collectManagedTerminalCensus: mocks.census
}))
vi.mock('../install/madangd-remote-runtime-control', () => ({
  execMadangdRemote: mocks.exec
}))

const { readManagedMadangdLaunchSshSession, restartManagedMadangdEnvironment } =
  await import('./madangd-managed-launch-session')

const census = (liveSessions: number | null) => ({
  liveSessions,
  startedSinceActivation: liveSessions,
  daemonProtocolVersion: 1
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.host.current = getRemoteHostPlatform('darwin-arm64')
  mocks.active.current = '1.0.0'
  mocks.lockBusy.current = false
  mocks.stop.mockResolvedValue({ state: 'retired' })
  mocks.exec.mockResolvedValue('')
  mocks.wake.mockResolvedValue({ outcome: 'started', readiness: {} })
})

describe('restartManagedMadangdEnvironment', () => {
  it.each([2, null])(
    'never stops a server while terminals run or are uncounted (%s)',
    async (n) => {
      mocks.census.mockResolvedValue(census(n))
      await expect(restartManagedMadangdEnvironment('/u', 'env-1')).resolves.toEqual({
        outcome: 'terminals-running',
        liveSessions: n
      })
      expect(mocks.stop).not.toHaveBeenCalled()
      expect(mocks.wake).not.toHaveBeenCalled()
    }
  )

  it('stops, starts from this session and follows the new port', async () => {
    mocks.census.mockResolvedValue(census(0))
    await expect(restartManagedMadangdEnvironment('/u', 'env-1')).resolves.toEqual({
      outcome: 'restarted',
      environmentId: 'env-1'
    })
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.wake).toHaveBeenCalledOnce()
    expect(mocks.rebuild).toHaveBeenCalledWith('/u', 'env-1')
  })

  it('does not claim recovery when the restart’s own SSH session already ended', async () => {
    mocks.census.mockResolvedValue(census(0))
    mocks.exec.mockImplementation(async (_slot: unknown, command: string) =>
      command.includes('sw_vers') ? 'EXITED\n' : ''
    )
    const result = await restartManagedMadangdEnvironment('/u', 'env-1')
    expect(result.outcome).toBe('not-restarted')
    expect(mocks.wake).toHaveBeenCalledOnce()
  })

  it('keeps the fence when the stop may still be running', async () => {
    mocks.census.mockResolvedValue(census(0))
    mocks.stop.mockResolvedValue({ state: 'unsettled', reason: 'still stopping' })
    await restartManagedMadangdEnvironment('/u', 'env-1')
    expect(mocks.retain).toHaveBeenCalledOnce()
  })

  it('leaves a server it could not prove stopped running', async () => {
    mocks.census.mockResolvedValue(census(0))
    mocks.stop.mockResolvedValue({ state: 'unsettled', reason: 'still stopping' })
    const result = await restartManagedMadangdEnvironment('/u', 'env-1')
    expect(result).toEqual({ outcome: 'not-restarted', reason: 'still stopping' })
    expect(mocks.wake).not.toHaveBeenCalled()
  })

  it('starts the server again but keeps the warning when the daemon was not retired', async () => {
    mocks.census.mockResolvedValue(census(0))
    mocks.stop.mockResolvedValue({ state: 'unproven', reason: 'a terminal started' })
    const result = await restartManagedMadangdEnvironment('/u', 'env-1')
    expect(result.outcome).toBe('not-restarted')
    expect(mocks.wake).toHaveBeenCalledOnce()
    expect(mocks.rebuild).toHaveBeenCalledOnce()
  })
})

describe('restartManagedMadangdEnvironment terminal admission', () => {
  const closes = () => mocks.census.mock.calls.map((call) => call[4]?.closeAdmissionForMs)
  const FENCED = [undefined, MADANGD_UPDATE_ADMISSION_FENCE_MS]

  it('closes admission at its count under the host lock, so nothing starts before the stop', async () => {
    mocks.census.mockResolvedValue(census(0))
    await restartManagedMadangdEnvironment('/u', 'env-1')
    expect(closes()).toEqual(FENCED)
  })

  it('never touches admission when the host lock is busy, so another update keeps its fence', async () => {
    mocks.census.mockResolvedValue(census(0))
    mocks.lockBusy.current = true
    const result = await restartManagedMadangdEnvironment('/u', 'env-1')
    expect(result.outcome).toBe('not-restarted')
    expect(closes()).toEqual([undefined])
  })

  it.each([
    ['a terminal opened before the recount', census(1), undefined],
    ['the stop was withdrawn', census(0), { state: 'withdrawn', reason: 'withdrawn' }]
  ])('reopens admission on the serving server when %s', async (_case, recount, stop) => {
    mocks.census.mockResolvedValueOnce(census(0)).mockResolvedValueOnce(recount)
    mocks.census.mockResolvedValue(census(0))
    if (stop) {
      mocks.stop.mockResolvedValue(stop)
    }
    await restartManagedMadangdEnvironment('/u', 'env-1')
    expect(closes()).toEqual([...FENCED, 0])
  })

  it('leaves admission closed while the stop may still land', async () => {
    mocks.census.mockResolvedValue(census(0))
    mocks.stop.mockResolvedValue({ state: 'unsettled', reason: 'still stopping' })
    await restartManagedMadangdEnvironment('/u', 'env-1')
    expect(closes()).toEqual(FENCED)
  })

  it('leaves admission closed when the stop fails without saying whether it was sent', async () => {
    mocks.census.mockResolvedValue(census(0))
    mocks.stop.mockRejectedValue(new Error('SSH command timed out'))
    await expect(restartManagedMadangdEnvironment('/u', 'env-1')).rejects.toThrow('timed out')
    expect(closes()).toEqual(FENCED)
  })

  it('stops nothing once the count may have outlived its fence', async () => {
    type Options = { closeAdmissionForMs?: number }
    mocks.census.mockImplementation(
      async (...args: [unknown, unknown, unknown, unknown, Options]) => {
        if (args[4]?.closeAdmissionForMs) {
          vi.setSystemTime(Date.now() + MADANGD_UPDATE_ADMISSION_STOP_BY_MS + 1)
        }
        return census(0)
      }
    )
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const result = await restartManagedMadangdEnvironment('/u', 'env-1')
      expect(result.outcome).toBe('not-restarted')
      expect(mocks.stop).not.toHaveBeenCalled()
      expect(closes()).toEqual([...FENCED, 0])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('readManagedMadangdLaunchSshSession', () => {
  it('probes a macOS host’s active slot', async () => {
    mocks.exec.mockResolvedValue('EXITED\n')
    await expect(readManagedMadangdLaunchSshSession('/u', 'env-1')).resolves.toBe('exited')
  })

  it('runs nothing on a Linux host', async () => {
    mocks.host.current = getRemoteHostPlatform('linux-x64')
    await expect(readManagedMadangdLaunchSshSession('/u', 'env-1')).resolves.toBe('not-applicable')
    expect(mocks.exec).not.toHaveBeenCalled()
  })
})
