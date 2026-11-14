export type ClaudeAccountSwitchRunningSessions = 'ask' | 'restart' | 'keep'

export type ClaudeAccountSwitchSettings = {
  /** Absent means 'ask'. */
  claudeAccountSwitchRunningSessions?: ClaudeAccountSwitchRunningSessions
  /** Switch Claude/Codex to a less-used account when the active one is nearly out. Absent means off. */
  accountAutoSwitch?: boolean
  /** With accountAutoSwitch: spend a Codex rate-limit reset credit when no other account has room. Absent means off. */
  accountAutoSwitchUseResetCredit?: boolean
}
