import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClaudeOAuthCredentials from './claude-oauth-credentials'
import { readClaudeOAuthCredentials } from './claude-oauth-credentials'
import { fetchActiveClaudeRateLimits } from './claude-active-usage-fetch'
import { probeCodexAuthPresence } from './codex-auth-presence'
import { fetchCodexRateLimits } from './codex-fetcher'
import { setUsageOptInResolvers } from './usage-opt-in'

vi.mock('./claude-oauth-credentials', async (importOriginal) => ({
  ...(await importOriginal<typeof ClaudeOAuthCredentials>()),
  readClaudeOAuthCredentials: vi.fn(async () => ({
    token: null,
    source: 'none',
    unavailable: false,
    hasRefreshableCredentials: false
  }))
}))
vi.mock('./codex-auth-presence', () => ({ probeCodexAuthPresence: vi.fn(async () => 'absent') }))

describe('usage opt-in', () => {
  const fetchSpy = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy)
    vi.clearAllMocks()
  })
  afterEach(() => {
    setUsageOptInResolvers({ claude: () => true, codex: () => true })
    vi.unstubAllGlobals()
  })

  it('does not read tokens or send requests when disabled', async () => {
    setUsageOptInResolvers({ claude: () => false, codex: () => false })

    const claude = await fetchActiveClaudeRateLimits()
    const codex = await fetchCodexRateLimits()

    expect(claude).toMatchObject({ provider: 'claude', status: 'unavailable' })
    expect(codex).toMatchObject({ provider: 'codex', status: 'unavailable' })
    expect(readClaudeOAuthCredentials).not.toHaveBeenCalled()
    expect(probeCodexAuthPresence).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the existing behavior when enabled', async () => {
    setUsageOptInResolvers({ claude: () => true, codex: () => true })

    await fetchActiveClaudeRateLimits()
    const codex = await fetchCodexRateLimits()

    expect(readClaudeOAuthCredentials).toHaveBeenCalledTimes(1)
    expect(probeCodexAuthPresence).toHaveBeenCalledTimes(1)
    expect(codex).toMatchObject({ error: 'Codex not signed in' })
  })
})
