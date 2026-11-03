/**
 * Official Windows install one-liners, from the vendors' own docs (checked 2026-11-03):
 *  - Claude Code: https://code.claude.com/docs/en/setup  (`irm https://claude.ai/install.ps1 | iex`)
 *  - Codex CLI:   https://github.com/openai/codex        (`irm https://chatgpt.com/codex/install.ps1 | iex`)
 * The command comes from this list only, never from the renderer.
 */
export const AGENT_CLI_INSTALL_SCRIPTS = {
  claude: 'irm https://claude.ai/install.ps1 | iex',
  codex: 'irm https://chatgpt.com/codex/install.ps1 | iex'
} as const

export type InstallableAgentCli = keyof typeof AGENT_CLI_INSTALL_SCRIPTS

export function isInstallableAgentCli(agent: unknown): agent is InstallableAgentCli {
  return typeof agent === 'string' && Object.hasOwn(AGENT_CLI_INSTALL_SCRIPTS, agent)
}

export type InstallAgentCliResult =
  | { status: 'finished'; exitCode: number | null }
  | { status: 'unsupported' }
  | { status: 'failed'; error: string }
