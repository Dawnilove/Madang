import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: { settings: null as Record<string, unknown> | null, fetchSettings: vi.fn(async () => {}) },
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  selectCodex: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { info: h.toastInfo, error: h.toastError } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => h.state } }))
vi.mock('@/runtime/runtime-provider-accounts-client', () => ({
  selectClaudeProviderAccount: vi.fn(),
  selectCodexProviderAccount: h.selectCodex
}))
vi.mock('./claude-account-switch-sessions', () => ({
  handleRunningClaudeSessionsAfterSwitch: vi.fn()
}))

import type {
  CodexRateLimitResetOutcome,
  InactiveAccountUsage,
  ProviderRateLimits,
  RateLimitState
} from '../../../shared/rate-limit-types'
import { isNearLimit, peakUsedPercent, pickAutoSwitchAccountId } from './account-auto-switch'

function limits(
  session: number | null,
  weekly: number | null,
  extra: Partial<ProviderRateLimits> = {}
): ProviderRateLimits {
  const window = (usedPercent: number | null) =>
    usedPercent === null
      ? null
      : { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null }
  return {
    provider: 'claude',
    session: window(session),
    weekly: window(weekly),
    status: 'ok',
    updatedAt: Date.now(),
    ...extra
  } as ProviderRateLimits
}

function other(accountId: string, rateLimits: ProviderRateLimits | null): InactiveAccountUsage {
  return { accountId, rateLimits, updatedAt: 0, isFetching: false }
}

describe('peakUsedPercent / isNearLimit', () => {
  it('uses the fuller window and treats unknown usage as not near the limit', () => {
    expect(peakUsedPercent(limits(40, 95))).toBe(95)
    expect(peakUsedPercent(limits(null, null))).toBeNull()
    expect(peakUsedPercent(null)).toBeNull()
    expect(isNearLimit(limits(89.9, 10))).toBe(false)
    expect(isNearLimit(limits(90, 10))).toBe(true)
    expect(isNearLimit(limits(10, 90))).toBe(true)
    expect(isNearLimit(null)).toBe(false)
  })
})

describe('pickAutoSwitchAccountId', () => {
  it('does nothing while the active account has room', () => {
    expect(pickAutoSwitchAccountId(limits(50, 50), [other('b', limits(0, 0))])).toBeNull()
  })

  it('picks the least-used account below 85%', () => {
    const others = [other('b', limits(60, 20)), other('c', limits(10, 30)), other('d', null)]
    expect(pickAutoSwitchAccountId(limits(95, 10), others)).toBe('c')
  })

  it('skips accounts at 85% or more and accounts with unknown usage', () => {
    const others = [other('b', limits(85, 0)), other('c', limits(null, null)), other('d', null)]
    expect(pickAutoSwitchAccountId(limits(95, 10), others)).toBeNull()
    expect(pickAutoSwitchAccountId(limits(95, 10), [other('b', limits(84.9, 0))])).toBe('b')
  })

  it('skips accounts whose usage failed to load or is older than 30 minutes', () => {
    const now = Date.now()
    const failed = limits(5, 5, { status: 'error' })
    const stale = limits(5, 5, { updatedAt: now - 31 * 60_000 })
    const fresh = limits(40, 40, { updatedAt: now - 29 * 60_000 })
    expect(pickAutoSwitchAccountId(limits(95, 10), [other('b', failed), other('c', stale)])).toBeNull()
    expect(
      pickAutoSwitchAccountId(limits(95, 10), [other('b', failed), other('c', stale), other('d', fresh)])
    ).toBe('d')
  })
})

describe('maybeAutoSwitchAccounts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    h.state.settings = null
  })

  // A fresh module per case, because the cooldown and failure flags live at module level.
  async function setup(opts: {
    outcome?: CodexRateLimitResetOutcome
    inactive?: InactiveAccountUsage[]
    credits?: number
    useCredit?: boolean
  }) {
    vi.resetModules()
    h.state.settings = {
      accountAutoSwitch: true,
      accountAutoSwitchUseResetCredit: opts.useCredit ?? true
    }
    const codex = limits(95, 10, {
      provider: 'codex',
      rateLimitResetCredits: { availableCount: opts.credits ?? 1 }
    })
    const host = { runtime: 'host', wslDistro: null }
    const state = {
      claude: null,
      codex,
      claudeTarget: host,
      codexTarget: host,
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: opts.inactive ?? []
    } as unknown as RateLimitState
    const consume = vi.fn(async () => ({ outcome: opts.outcome ?? 'reset', state }))
    vi.stubGlobal('window', {
      api: {
        rateLimits: {
          fetchInactiveClaudeAccounts: vi.fn(async () => {}),
          fetchInactiveCodexAccounts: vi.fn(async () => {}),
          get: vi.fn(async () => state),
          consumeCodexResetCredit: consume
        }
      }
    })
    const { maybeAutoSwitchAccounts } = await import('./account-auto-switch')
    return { maybeAutoSwitchAccounts, state, consume }
  }

  it('says a reset credit was used only when the outcome is "reset"', async () => {
    const used = await setup({ outcome: 'reset' })
    used.maybeAutoSwitchAccounts(used.state)
    await vi.waitFor(() => expect(h.toastInfo).toHaveBeenCalledTimes(1))

    vi.clearAllMocks()
    const idle = await setup({ outcome: 'nothingToReset' })
    idle.maybeAutoSwitchAccounts(idle.state)
    await vi.waitFor(() => expect(idle.consume).toHaveBeenCalledTimes(1))
    expect(h.toastInfo).not.toHaveBeenCalled()
  })

  it('does not spend a credit when the credit switch is off or none is left', async () => {
    const off = await setup({ useCredit: false })
    off.maybeAutoSwitchAccounts(off.state)
    const none = await setup({ credits: 0 })
    none.maybeAutoSwitchAccounts(none.state)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(off.consume).not.toHaveBeenCalled()
    expect(none.consume).not.toHaveBeenCalled()
  })

  it('shows one error toast per failure streak and keeps retrying quietly', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    h.selectCodex.mockRejectedValue(new Error('needs sign-in'))
    const { maybeAutoSwitchAccounts, state } = await setup({ inactive: [other('b', limits(10, 10))] })
    maybeAutoSwitchAccounts(state)
    await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1))

    vi.setSystemTime(Date.now() + 6 * 60_000)
    maybeAutoSwitchAccounts(state)
    await vi.waitFor(() => expect(h.selectCodex).toHaveBeenCalledTimes(2))
    expect(h.toastError).toHaveBeenCalledTimes(1)
  })

  it('does nothing when auto-switch is off', async () => {
    const { maybeAutoSwitchAccounts, state, consume } = await setup({})
    h.state.settings = { accountAutoSwitch: false }
    maybeAutoSwitchAccounts(state)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(consume).not.toHaveBeenCalled()
    expect(h.selectCodex).not.toHaveBeenCalled()
  })
})
