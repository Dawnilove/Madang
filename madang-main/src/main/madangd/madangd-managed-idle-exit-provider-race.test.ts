import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MADANGD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/madangd-managed-launch-env'
import { bindMadangdIdleShutdown, beginMadangdIdleExit } from './madangd-managed-idle-exit-host'
import { installMadangdManagedIdleExit } from './madangd-managed-idle-exit'
import type * as ManagedIdleExit from './madangd-managed-idle-exit'
import type * as DaemonProviderState from '../daemon/daemon-provider-state'
import { retireMadangdDaemonIfIdle } from './madangd-daemon-retirement'
import { discardMadangdIdleStopRecord } from './madangd-idle-stop-record'
import { restartDaemon } from '../daemon/daemon-provider-restart'

const { hasLoadedProviders } = vi.hoisted(() => ({ hasLoadedProviders: vi.fn(() => false) }))

vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => ({ hasLoadedProviders })
}))
vi.mock('../ipc/pty/provider/registry', () => ({
  getLocalPtyProvider: () => ({ listProcesses: async () => [] })
}))
vi.mock('../daemon/daemon-init', () => ({ getDaemonEndpointFacts: () => null }))
vi.mock('./madangd-daemon-retirement', () => ({
  countLiveMadangdDaemonSessions: vi.fn(async () => 0),
  retireMadangdDaemonIfIdle: vi.fn()
}))
vi.mock('../daemon/daemon-provider-state', async (importOriginal) => ({
  ...(await importOriginal<typeof DaemonProviderState>()),
  getCurrentDaemonPid: () => 4242
}))
vi.mock('../daemon/daemon-provider-restart', () => ({ restartDaemon: vi.fn(async () => ({})) }))
vi.mock('./madangd-idle-stop-record', () => ({
  consumeMadangdIdleStopRecord: vi.fn(() => null),
  discardMadangdIdleStopRecord: vi.fn(),
  writeMadangdIdleStopRecord: vi.fn()
}))
vi.mock('./madangd-managed-idle-exit', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedIdleExit>()),
  installMadangdManagedIdleExit: vi.fn(() => () => {})
}))

beforeEach(() => {
  vi.clearAllMocks()
  hasLoadedProviders.mockReturnValue(false)
  vi.stubEnv(MADANGD_MANAGED_ACTIVATION_ROOT_ENV, 'test-fence')
})

afterEach(() => vi.unstubAllEnvs())

it.each(['provider', 'client', 'request', 'recent request'])(
  'rechecks a returning %s after daemon retirement before requesting an idle shutdown',
  async (returning) => {
    const activity = { openConnections: 0, requestsInFlight: 0, lastRequestAt: 0 }
    const retire = Promise.withResolvers<{ retirement: string; reason: null }>()
    vi.mocked(retireMadangdDaemonIfIdle).mockImplementationOnce(async () => ({
      ...(await retire.promise),
      retirement: 'retired',
      liveSessions: 0
    }))
    const shutdown = vi.fn(() => true)
    bindMadangdIdleShutdown(shutdown)
    await beginMadangdIdleExit('test-profile').start({
      rpc: {
        readClientActivity: () => activity
      },
      agentStates: () => [],
      hasStagedMigration: () => false,
      automationsBusy: () => false,
      emulatorsBusy: async () => false,
      registerCleanup: () => {}
    })
    const installed = vi.mocked(installMadangdManagedIdleExit).mock.calls.at(-1)?.[0]
    if (!installed) {
      throw new Error('idle monitor was not installed')
    }
    const stopping = installed.stop({ quietSince: 0, stoppedAt: 900_000, timeoutMs: 900_000 })
    hasLoadedProviders.mockReturnValue(returning === 'provider')
    activity.openConnections = returning === 'client' ? 1 : 0
    activity.requestsInFlight = returning === 'request' ? 1 : 0
    activity.lastRequestAt = returning === 'recent request' ? 1 : 0
    retire.resolve({ retirement: 'retired', reason: null })

    expect(await stopping).toBe(false)
    expect(shutdown).not.toHaveBeenCalled()
    expect(discardMadangdIdleStopRecord).toHaveBeenCalledWith('test-profile')
    expect(restartDaemon).toHaveBeenCalledOnce()
  }
)
