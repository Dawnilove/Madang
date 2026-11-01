import { describe, expect, it, vi } from 'vitest'
import { HostAccountLaunchEnvParams } from '../../shared/host-account-launch-env'
import { HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY } from '../../shared/madangd-runtime-capabilities'
import type { WslMadangdAccountEnvDependencies } from './wsl-madangd-account-env'
import type { WslMadangdHostCapabilityVerdict } from './wsl-madangd-host-environments'
import {
  changesWslHostAccounts,
  pushWslMadangdHostAccountEnv,
  type WslMadangdHostAccountPush
} from './wsl-madangd-host-account-push'

const POINTER = '~/.orca-claude-profile-pointer-test'
const CLAUDE_HOME = '/home/u/.madang/claude-accounts/acct-a/config'

function dependencies(
  overrides: Partial<WslMadangdAccountEnvDependencies> = {}
): WslMadangdAccountEnvDependencies {
  return {
    prepareClaudeLaunch: vi.fn(async () => ({
      configDir: CLAUDE_HOME,
      runtime: 'wsl' as const,
      wslDistro: 'Ubuntu',
      envPatch: {
        CLAUDE_CONFIG_DIR: CLAUDE_HOME,
        MADANG_CLAUDE_INJECTED_CONFIG_DIR: CLAUDE_HOME
      },
      provenance: 'profile:acct-a:wsl:Ubuntu'
    })),
    claudeTerminalEnv: vi.fn(() => ({ MADANG_CLAUDE_PROFILE_POINTER: POINTER })),
    prepareCodexHome: vi.fn(async () => '\\\\wsl.localhost\\Ubuntu\\home\\u\\.madang\\codex-b'),
    managedAccountSelected: vi.fn(() => true),
    accountNotApplied: vi.fn(),
    ...overrides
  }
}

function push(
  verdict: WslMadangdHostCapabilityVerdict,
  call: WslMadangdHostAccountPush['call'] = vi.fn(async () => ({
    id: 'accounts.setHostLaunchEnv',
    ok: true as const,
    result: {},
    _meta: { runtimeId: 'r' }
  }))
): WslMadangdHostAccountPush {
  return {
    environmentId: 'wsl:Ubuntu',
    distro: 'Ubuntu',
    hostSupports: vi.fn(async () => verdict),
    call
  }
}

describe('pushWslMadangdHostAccountEnv', () => {
  it("gives the host its distro's selected accounts, valid on the wire", async () => {
    const target = push('supported')
    await pushWslMadangdHostAccountEnv(target, dependencies())
    expect(target.hostSupports).toHaveBeenCalledWith(HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY)
    const [method, params] = vi.mocked(target.call).mock.calls[0]
    expect(method).toBe('accounts.setHostLaunchEnv')
    expect(HostAccountLaunchEnvParams.parse(params)).toEqual({
      wslDistro: 'Ubuntu',
      claude: {
        CLAUDE_CONFIG_DIR: CLAUDE_HOME,
        MADANG_CLAUDE_INJECTED_CONFIG_DIR: CLAUDE_HOME,
        CODEX_HOME: '/home/u/.madang/codex-b'
      },
      terminal: {
        MADANG_CLAUDE_PROFILE_POINTER: POINTER,
        CODEX_HOME: '/home/u/.madang/codex-b'
      }
    })
  })

  it('tells the user once an older host cannot take a selected account, and sends nothing', async () => {
    const deps = dependencies()
    const target = push('unsupported')
    await pushWslMadangdHostAccountEnv(target, deps)
    expect(target.call).not.toHaveBeenCalled()
    expect(deps.accountNotApplied).toHaveBeenCalledWith('Ubuntu')
  })

  it('neither sends nor warns while the host cannot be asked, and retries', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const deps = dependencies()
      const target = push('unknown')
      await pushWslMadangdHostAccountEnv(target, deps, [1_000])
      expect(target.call).not.toHaveBeenCalled()
      expect(deps.accountNotApplied).not.toHaveBeenCalled()
      vi.mocked(target.hostSupports).mockResolvedValue('supported')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(target.call).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('lands pushes in order, so an older selection never overwrites a newer one', async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const slowFirst = new Promise<void>((resolve) => {
      release = resolve
    })
    const deps = (home: string, gate?: Promise<void>) =>
      dependencies({
        prepareCodexHome: vi.fn(async () => {
          await gate
          return home
        })
      })
    const call: WslMadangdHostAccountPush['call'] = vi.fn(async (_method, params) => {
      order.push(HostAccountLaunchEnvParams.parse(params).terminal.CODEX_HOME ?? '')
      return {
        id: 'm',
        ok: true as const,
        result: {},
        _meta: { runtimeId: 'r' }
      }
    })
    const first = pushWslMadangdHostAccountEnv(push('supported', call), deps('/old', slowFirst))
    const second = pushWslMadangdHostAccountEnv(push('supported', call), deps('/new'))
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['/old', '/new'])
  })
})

describe('changesWslHostAccounts', () => {
  it('fires on a selection or roster change only', () => {
    expect(
      changesWslHostAccounts({
        activeCodexManagedAccountIdsByRuntime: undefined
      })
    ).toBe(true)
    expect(changesWslHostAccounts({ claudeManagedAccounts: [] })).toBe(true)
    expect(changesWslHostAccounts({ experimentalWslHosts: true })).toBe(false)
  })
})

describe('pushWslMadangdHostAccountEnv retries', () => {
  it('retries a failed push, and stops once a newer push supersedes it', async () => {
    vi.useFakeTimers()
    try {
      const call = vi
        .fn<WslMadangdHostAccountPush['call']>()
        .mockResolvedValueOnce({
          id: 'm',
          ok: false,
          error: { code: 'unavailable', message: 'down' },
          _meta: { runtimeId: 'r' }
        })
        .mockResolvedValue({ id: 'm', ok: true, result: {}, _meta: { runtimeId: 'r' } })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await pushWslMadangdHostAccountEnv(push('supported', call), dependencies(), [1_000])
      expect(call).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(call).toHaveBeenCalledTimes(2)

      const failing = vi.fn<WslMadangdHostAccountPush['call']>().mockResolvedValue({
        id: 'm',
        ok: false,
        error: { code: 'unavailable', message: 'down' },
        _meta: { runtimeId: 'r' }
      })
      await pushWslMadangdHostAccountEnv(push('supported', failing), dependencies(), [1_000])
      await pushWslMadangdHostAccountEnv(push('supported', call), dependencies(), [1_000])
      await vi.advanceTimersByTimeAsync(5_000)
      expect(failing).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})
