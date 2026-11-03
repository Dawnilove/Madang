/**
 * Official Windows install commands, copied from each vendor's own docs (researched 2026-11-03; sources and the
 * agents left out are in docs/분석/26_에이전트_설치명령_출처.md). The command comes from this list only, never from
 * the renderer. Each runs in a visible PowerShell window, so npm/winget need Node.js/winget on the PC and the
 * window shows the error when they are missing.
 */
export const AGENT_CLI_INSTALL_COMMANDS = {
  claude: 'irm https://claude.ai/install.ps1 | iex',
  codex: 'irm https://chatgpt.com/codex/install.ps1 | iex',
  copilot: 'winget install GitHub.Copilot',
  opencode: 'npm install -g opencode-ai',
  muse: 'irm https://dev.meta.ai/install.ps1 | iex',
  droid: 'irm https://app.factory.ai/cli/windows | iex',
  kimi: 'irm https://code.kimi.com/kimi-code/install.ps1 | iex',
  hermes: 'iex (irm https://hermes-agent.nousresearch.com/install.ps1)',
  devin: 'irm https://static.devin.ai/cli/setup.ps1 | iex',
  openclaw: 'iwr -useb https://openclaw.ai/install.ps1 | iex',
  codebuddy: 'irm https://www.codebuddy.cn/cli/install.ps1 | iex',
  pi: 'irm https://pi.dev/install.ps1 | iex',
  omp: 'irm https://omp.sh/install.ps1 | iex',
  'prime-agent': 'irm https://app.primeintellect.ai/prime-agent/install.ps1 | iex',
  antigravity: 'irm https://antigravity.google/cli/install.ps1 | iex',
  aider: 'irm https://aider.chat/install.ps1 | iex',
  kilo: 'npm install -g @kilocode/cli',
  crush: 'winget install charmbracelet.crush',
  aug: 'npm install -g @augmentcode/auggie@prerelease',
  cline: 'npm i -g cline',
  codebuff: 'npm install -g codebuff',
  freebuff: 'npm install -g freebuff',
  'command-code': 'npm i -g command-code@latest',
  continue:
    'irm https://raw.githubusercontent.com/continuedev/continue/main/extensions/cli/scripts/install.ps1 | iex',
  gemini: 'npm install -g @google/gemini-cli'
} as const

/** Kept for existing imports; same table. */
export const AGENT_CLI_INSTALL_SCRIPTS = AGENT_CLI_INSTALL_COMMANDS

export type InstallableAgentCli = keyof typeof AGENT_CLI_INSTALL_COMMANDS

export function isInstallableAgentCli(agent: unknown): agent is InstallableAgentCli {
  return typeof agent === 'string' && Object.hasOwn(AGENT_CLI_INSTALL_COMMANDS, agent)
}

export type InstallAgentCliResult =
  | { status: 'finished'; exitCode: number | null }
  | { status: 'unsupported' }
  | { status: 'failed'; error: string }
