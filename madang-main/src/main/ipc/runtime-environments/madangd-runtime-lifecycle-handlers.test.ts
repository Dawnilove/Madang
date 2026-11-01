import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  deploy: vi.fn(),
  status: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../managed-server/lifecycle/madangd-runtime-deployment', () => ({
  createManagedMadangdEnvironment: mocks.deploy
}))
vi.mock('../../managed-server/lifecycle/madangd-runtime-status', () => ({
  getManagedMadangdRuntimeStatus: mocks.status
}))

const { registerMadangdRuntimeLifecycleHandlers } = await import('./madangd-runtime-lifecycle-handlers')

function handler(channel: string): (_event: unknown, args: unknown) => unknown {
  const registration = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`${channel} handler was not registered`)
  }
  return registration[1]
}

describe('managed madangd lifecycle IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerMadangdRuntimeLifecycleHandlers({ getUserDataPath: () => '/profile' })
  })

  it('registers only deploy and status; maintenance and stop are not exposed', () => {
    expect(mocks.handle.mock.calls.map(([channel]) => channel)).toEqual([
      'runtimeEnvironments:deployMadangd',
      'runtimeEnvironments:getMadangdStatus'
    ])
  })

  it('trims deploy input and treats only a literal true as force', async () => {
    await handler('runtimeEnvironments:deployMadangd')(null, {
      name: ' Managed ',
      sshTargetId: ' ssh-1 ',
      force: 'yes'
    })
    expect(mocks.deploy).toHaveBeenCalledWith('/profile', {
      name: 'Managed',
      sshTargetId: 'ssh-1',
      force: false
    })
  })

  it('rejects missing selectors before touching SSH', async () => {
    await expect(handler('runtimeEnvironments:deployMadangd')(null, { name: 'x' })).rejects.toThrow(
      'SSH target is required'
    )
    expect(() => handler('runtimeEnvironments:getMadangdStatus')(null, undefined)).toThrow(
      'Server is required'
    )
    expect(mocks.deploy).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
  })
})
