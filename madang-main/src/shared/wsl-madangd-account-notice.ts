/** Main → renderer: a WSL distro's madangd started an agent without the selected managed account,
 *  because it predates `agent-session.account-env.v1`. Sent at most once per distro per run. */
export const WSL_MADANGD_ACCOUNT_NOT_APPLIED_CHANNEL = 'runtimeEnvironments:wslAccountNotApplied'

export type WslMadangdAccountNotAppliedEvent = { distro: string }
