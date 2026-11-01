export type E2EConfig = {
  enabled: boolean
  headless: boolean
  exposeStore: boolean
  userDataDir: string | null
  /** MADANG_E2E_TERMINAL_PARKING_DELAY_MS shortens hidden-view parking delays; null retains production timing. */
  terminalParkingDelayMs: number | null
  /** MADANG_E2E_TERMINAL_RETENTION_LIMIT shrinks hidden unparkable retention; null retains production budget (12). */
  terminalRetentionLimit: number | null
  /** MADANG_E2E_ORCA_DEFAULTS=1 makes Madang start with Orca's UI defaults (shell, language, chat) for upstream specs. */
  orcaDefaults: boolean
}

type E2EConfigInput = {
  orcaDefaults?: boolean
  headless?: boolean
  exposeStore?: boolean
  userDataDir?: string | null
  terminalParkingDelayMs?: number | null
  terminalRetentionLimit?: number | null
}

export function createE2EConfig(input: E2EConfigInput): E2EConfig {
  const userDataDir = input.userDataDir?.trim() || null
  const headless = Boolean(input.headless)
  const exposeStore = Boolean(input.exposeStore)
  const terminalParkingDelayMs =
    typeof input.terminalParkingDelayMs === 'number' &&
    Number.isFinite(input.terminalParkingDelayMs) &&
    input.terminalParkingDelayMs > 0
      ? input.terminalParkingDelayMs
      : null
  // Why: a worktree count — only a positive integer is a meaningful budget.
  const terminalRetentionLimit =
    typeof input.terminalRetentionLimit === 'number' &&
    Number.isInteger(input.terminalRetentionLimit) &&
    input.terminalRetentionLimit > 0
      ? input.terminalRetentionLimit
      : null

  return {
    enabled: headless || exposeStore || userDataDir !== null,
    headless,
    exposeStore,
    userDataDir,
    terminalParkingDelayMs,
    terminalRetentionLimit,
    orcaDefaults: Boolean(input.orcaDefaults)
  }
}
