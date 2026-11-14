import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isCompanyEdition } from '../../../shared/madang-edition'
import type {
  InactiveAccountUsage,
  ProviderRateLimits,
  RateLimitState
} from '../../../shared/rate-limit-types'
import {
  selectClaudeProviderAccount,
  selectCodexProviderAccount
} from '@/runtime/runtime-provider-accounts-client'
import { handleRunningClaudeSessionsAfterSwitch } from './claude-account-switch-sessions'

/** Leave the active account at this usage (5-hour or weekly window, whichever is higher). */
export const AUTO_SWITCH_AT_PERCENT = 90
/** Only move to an account below this, so two nearly-full accounts do not trade places. */
export const AUTO_SWITCH_TARGET_BELOW_PERCENT = 85
/** No second switch (or reset credit) for a provider within this time. */
export const AUTO_SWITCH_COOLDOWN_MS = 15 * 60_000
/** With nowhere to go, look again no sooner than this. */
export const AUTO_SWITCH_RETRY_MS = 5 * 60_000

type Provider = 'claude' | 'codex'

/** The fuller of the 5-hour and weekly windows; null when usage is unknown. */
export function peakUsedPercent(limits: ProviderRateLimits | null): number | null {
  const percents = [limits?.session?.usedPercent, limits?.weekly?.usedPercent].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )
  return percents.length === 0 ? null : Math.max(...percents)
}

export function isNearLimit(limits: ProviderRateLimits | null): boolean {
  const peak = peakUsedPercent(limits)
  return peak !== null && peak >= AUTO_SWITCH_AT_PERCENT
}

/** An account whose usage was last read longer ago than this is not trusted (e.g. its fetch is backing off after a 429). */
export const AUTO_SWITCH_MAX_USAGE_AGE_MS = 30 * 60_000

/**
 * The least-used other account with room, or null. Accounts with unknown, failed or stale usage
 * are never picked: a stale low reading could point at an account that is already out.
 */
export function pickAutoSwitchAccountId(
  active: ProviderRateLimits | null,
  inactive: readonly InactiveAccountUsage[],
  now = Date.now()
): string | null {
  if (!isNearLimit(active)) {
    return null
  }
  let best: { accountId: string; peak: number } | null = null
  for (const account of inactive) {
    const limits = account.rateLimits
    if (!limits || limits.status !== 'ok' || now - limits.updatedAt > AUTO_SWITCH_MAX_USAGE_AGE_MS) {
      continue
    }
    const peak = peakUsedPercent(limits)
    if (peak === null || peak >= AUTO_SWITCH_TARGET_BELOW_PERCENT) {
      continue
    }
    if (!best || peak < best.peak) {
      best = { accountId: account.accountId, peak }
    }
  }
  return best?.accountId ?? null
}

const busy: Record<Provider, boolean> = { claude: false, codex: false }
const lastActedAt: Record<Provider, number> = { claude: 0, codex: 0 }
const lastTriedAt: Record<Provider, number> = { claude: 0, codex: 0 }
const failureNotified: Record<Provider, boolean> = { claude: false, codex: false }

const LOCAL_OWNER = { kind: 'local' } as const
const HOST_TARGET = { runtime: 'host', wslDistro: null } as const

async function switchClaude(accountId: string): Promise<void> {
  const before = await window.api.claudeAccounts.list()
  const next = await selectClaudeProviderAccount(LOCAL_OWNER, { accountId, ...HOST_TARGET })
  await useAppStore.getState().fetchSettings()
  // Same follow-up as a manual switch: the user's ask / restart / keep setting decides running chats.
  void handleRunningClaudeSessionsAfterSwitch({
    owner: LOCAL_OWNER,
    target: HOST_TARGET,
    before: { state: before, accountId: before.activeAccountId },
    after: { state: next, accountId: next.activeAccountId }
  })
}

async function switchCodex(accountId: string): Promise<void> {
  await selectCodexProviderAccount(LOCAL_OWNER, { accountId, ...HOST_TARGET })
  await useAppStore.getState().fetchSettings()
}

async function autoSwitchProvider(provider: Provider): Promise<void> {
  const now = Date.now()
  if (
    busy[provider] ||
    now - lastActedAt[provider] < AUTO_SWITCH_COOLDOWN_MS ||
    now - lastTriedAt[provider] < AUTO_SWITCH_RETRY_MS
  ) {
    return
  }
  busy[provider] = true
  lastTriedAt[provider] = now
  const name = provider === 'claude' ? 'Claude' : 'Codex'
  try {
    // Other accounts' usage is only read on demand, so read it before choosing (main debounces this).
    await (provider === 'claude'
      ? window.api.rateLimits.fetchInactiveClaudeAccounts()
      : window.api.rateLimits.fetchInactiveCodexAccounts())
    const state = (await window.api.rateLimits.get()) as RateLimitState
    const active = state[provider]
    // shortcut: host runtime only; add WSL/remote targets if auto-switch is wanted there.
    const target = provider === 'claude' ? state.claudeTarget : state.codexTarget
    if (target.runtime !== 'host' || !isNearLimit(active)) {
      return
    }
    const accountId = pickAutoSwitchAccountId(
      active,
      provider === 'claude' ? state.inactiveClaudeAccounts : state.inactiveCodexAccounts
    )
    if (accountId) {
      await (provider === 'claude' ? switchClaude(accountId) : switchCodex(accountId))
      lastActedAt[provider] = Date.now()
      failureNotified[provider] = false
      toast.info(
        translate(
          'accounts.autoSwitch.switched',
          '{{value0}} was near its usage limit. Switched to another account.',
          { value0: name }
        )
      )
      return
    }
    const settings = useAppStore.getState().settings
    if (
      provider === 'codex' &&
      settings?.accountAutoSwitchUseResetCredit === true &&
      (active?.rateLimitResetCredits?.availableCount ?? 0) > 0
    ) {
      const result = await window.api.rateLimits.consumeCodexResetCredit()
      // Why: only 'reset' spent a credit; 'nothingToReset', 'noCredit' and 'alreadyRedeemed' must not claim it.
      if (result.outcome === 'reset') {
        lastActedAt[provider] = Date.now()
        failureNotified[provider] = false
        toast.info(
          translate(
            'accounts.autoSwitch.resetCreditUsed',
            'No Codex account had room, so a rate-limit reset credit was used.'
          )
        )
      } else {
        console.info('[account-auto-switch] Codex reset credit not used:', result.outcome)
      }
    }
  } catch (error) {
    console.warn(`[account-auto-switch] ${provider} failed:`, error)
    // One error toast per streak: retries run every few minutes and must not nag.
    if (!failureNotified[provider]) {
      failureNotified[provider] = true
      toast.error(
        translate(
          'accounts.autoSwitch.failed',
          'Automatic account switch for {{value0}} failed. Switch accounts by hand in Settings → AI Provider Accounts.',
          { value0: name }
        )
      )
    }
  } finally {
    busy[provider] = false
  }
}

/** Called on every usage update. Does nothing unless the user turned auto-switch on. */
export function maybeAutoSwitchAccounts(state: RateLimitState): void {
  const settings = useAppStore.getState().settings
  // Why: the company edition never reads usage, and a remote runtime owns its own accounts.
  if (
    isCompanyEdition() ||
    settings?.accountAutoSwitch !== true ||
    settings.activeRuntimeEnvironmentId
  ) {
    return
  }
  for (const provider of ['claude', 'codex'] as const) {
    if (isNearLimit(state[provider])) {
      void autoSwitchProvider(provider)
    } else {
      // The account has room again, so a later failure is a new streak worth one toast.
      failureNotified[provider] = false
    }
  }
}
