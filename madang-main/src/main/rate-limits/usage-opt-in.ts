import type { ProviderRateLimits } from '../../shared/rate-limit-types'

// Claude/Codex usage reads stored login tokens, so it runs only after the user opts in.
// Unset resolvers mean "enabled" so direct fetcher callers and tests keep working; app wiring sets both.
let claudeUsageEnabled: () => boolean = () => true
let codexUsageEnabled: () => boolean = () => true

export function setUsageOptInResolvers(resolvers: {
  claude: () => boolean
  codex: () => boolean
}): void {
  claudeUsageEnabled = resolvers.claude
  codexUsageEnabled = resolvers.codex
}

export function isClaudeUsageEnabled(): boolean {
  return claudeUsageEnabled()
}

export function isCodexUsageEnabled(): boolean {
  return codexUsageEnabled()
}

export function usageDisabledResult(provider: 'claude' | 'codex'): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: 'Usage lookup is disabled in settings',
    status: 'unavailable'
  }
}
