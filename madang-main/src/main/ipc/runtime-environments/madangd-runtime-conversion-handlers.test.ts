import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  convert: vi.fn(),
  pending: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../managed-server/lifecycle/madangd-runtime-conversion', () => ({
  convertSshTargetToManagedMadangd: mocks.convert
}))
vi.mock('../../managed-server/lifecycle/madangd-managed-migration-status', () => ({
  listPendingManagedMadangdMigrations: mocks.pending
}))
vi.mock('../../managed-server/lifecycle/madangd-runtime-conversion-wiring', () => ({
  conversionCollaborators: () => ({ marker: 'live-collaborators' })
}))

const { registerMadangdRuntimeConversionHandlers } =
  await import('./madangd-runtime-conversion-handlers')

function handler(channel: string): (_event: unknown, args?: unknown) => unknown {
  const registration = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`${channel} handler was not registered`)
  }
  return registration[1]
}

describe('managed server conversion IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerMadangdRuntimeConversionHandlers(() => '/profile')
  })

  it('converts with the live collaborators and lists pending migrations from the profile', async () => {
    mocks.convert.mockResolvedValue({ outcome: 'converted' })
    await handler('runtimeEnvironments:convertSshHostToManagedMadangd')(null, {
      sshTargetId: ' ssh-1 ',
      name: 'Builder'
    })
    expect(mocks.convert).toHaveBeenCalledWith('/profile', {
      sshTargetId: 'ssh-1',
      name: 'Builder',
      marker: 'live-collaborators'
    })
    handler('runtimeEnvironments:listPendingMadangdMigrations')(null)
    expect(mocks.pending).toHaveBeenCalledWith('/profile')
  })
})
