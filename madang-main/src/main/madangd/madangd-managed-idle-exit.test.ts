import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  activationFenceExists,
  createMadangdIdleProbes,
  resolveMadangdManagedIdleExit,
  type MadangdManagedIdleExitPorts
} from './madangd-managed-idle-exit'
import {
  MADANGD_E2E_IDLE_TIMEOUT_ENV,
  MADANGD_IDLE_EXIT_TIMEOUT_MS
} from '../../shared/madangd-idle-exit'
import { MADANGD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/madangd-managed-launch-env'

const config = { timeoutMs: 1_000, activationRoot: '/home/u/.madang-remote/.fence' }

function idlePorts(): MadangdManagedIdleExitPorts {
  return {
    readClientActivity: () => ({ openConnections: 0, requestsInFlight: 0, lastRequestAt: 0 }),
    listTerminals: async () => [],
    countDaemonSessions: async () => 0,
    hasDaemon: () => true,
    agentStates: () => [{ state: 'done' }],
    hasChatProviders: () => false,
    hasStagedMigration: () => false,
    automationsBusy: () => false,
    emulatorsBusy: async () => false,
    activationFenceExists: async () => false
  }
}

async function verdicts(ports: MadangdManagedIdleExitPorts): Promise<Record<string, string>> {
  const entries = await Promise.all(
    createMadangdIdleProbes(config, ports).map(async (probe) => [probe.name, await probe.read()])
  )
  return Object.fromEntries(entries)
}

describe('resolveMadangdManagedIdleExit', () => {
  it('stays off for a server the user started or paired', () => {
    expect(resolveMadangdManagedIdleExit({})).toBeNull()
    expect(resolveMadangdManagedIdleExit({ [MADANGD_E2E_IDLE_TIMEOUT_ENV]: '50' })).toBeNull()
  })

  it('matches the relay quiet period for a managed launch', () => {
    expect(resolveMadangdManagedIdleExit({ [MADANGD_MANAGED_ACTIVATION_ROOT_ENV]: '/f' })).toEqual({
      timeoutMs: MADANGD_IDLE_EXIT_TIMEOUT_MS,
      activationRoot: '/f'
    })
    expect(MADANGD_IDLE_EXIT_TIMEOUT_MS).toBe(15 * 60_000)
  })

  it.each([
    ['3000', 3_000],
    ['0', MADANGD_IDLE_EXIT_TIMEOUT_MS],
    ['-1', MADANGD_IDLE_EXIT_TIMEOUT_MS],
    ['1.5', MADANGD_IDLE_EXIT_TIMEOUT_MS],
    ['abc', MADANGD_IDLE_EXIT_TIMEOUT_MS],
    [String(2 * 60 * 60_000), MADANGD_IDLE_EXIT_TIMEOUT_MS]
  ])('accepts only a bounded test timeout (%s)', (raw, expected) => {
    expect(
      resolveMadangdManagedIdleExit({
        [MADANGD_MANAGED_ACTIVATION_ROOT_ENV]: '/f',
        [MADANGD_E2E_IDLE_TIMEOUT_ENV]: raw
      })?.timeoutMs
    ).toBe(expected)
  })
})

describe('createMadangdIdleProbes', () => {
  it('reads an unused host as idle on every probe', async () => {
    expect(await verdicts(idlePorts())).toEqual({
      clients: 'idle',
      terminals: 'idle',
      agents: 'idle',
      'chat-providers': 'idle',
      migration: 'idle',
      automations: 'idle',
      emulators: 'idle',
      activation: 'idle'
    })
  })

  it.each<[string, Partial<MadangdManagedIdleExitPorts>, string]>([
    [
      'an open client socket',
      {
        readClientActivity: () => ({ openConnections: 1, requestsInFlight: 0, lastRequestAt: 0 })
      },
      'clients'
    ],
    [
      'a request still running',
      {
        readClientActivity: () => ({ openConnections: 0, requestsInFlight: 1, lastRequestAt: 0 })
      },
      'clients'
    ],
    ['an in-process terminal', { listTerminals: async () => [{ id: 'pty-1' }] }, 'terminals'],
    ['a live daemon session', { countDaemonSessions: async () => 2 }, 'terminals'],
    ['a working agent', { agentStates: () => [{ state: 'working' }] }, 'agents'],
    ['a loaded chat provider', { hasChatProviders: () => true }, 'chat-providers'],
    ['a staged migration', { hasStagedMigration: () => true }, 'migration'],
    ['an enabled or running automation', { automationsBusy: () => true }, 'automations'],
    ['a Madang-started emulator', { emulatorsBusy: async () => true }, 'emulators'],
    ['a held activation fence', { activationFenceExists: async () => true }, 'activation']
  ])('reads %s as busy', async (_label, override, probe) => {
    expect((await verdicts({ ...idlePorts(), ...override }))[probe]).toBe('busy')
  })

  it('treats a daemon that did not answer as unverifiable, not as no terminals', async () => {
    const result = await verdicts({ ...idlePorts(), countDaemonSessions: async () => null })
    expect(result.terminals).toBe('unverifiable')
  })

  it('needs only the provider census when this madangd runs without a daemon', async () => {
    const result = await verdicts({
      ...idlePorts(),
      hasDaemon: () => false,
      countDaemonSessions: async () => null
    })
    expect(result.terminals).toBe('idle')
  })
})

describe('activationFenceExists', () => {
  let root: string | null = null
  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('follows the lock a client holds during an update, not a root an aborted acquire left', async () => {
    root = mkdtempSync(join(tmpdir(), 'madangd-fence-'))
    const fence = join(root, '.madangd-activation-transaction')
    expect(await activationFenceExists(fence)).toBe(false)
    mkdirSync(fence)
    expect(await activationFenceExists(fence)).toBe(false)
    mkdirSync(join(fence, '.install-lock'))
    expect(await activationFenceExists(fence)).toBe(true)
  })
})
