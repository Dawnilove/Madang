import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: "Prepare a WSL pane's Madang-managed Codex home before a shell launch",
    usage: 'madang agent hooks prepare-codex',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Madang-managed agent status hooks are enabled',
    usage: 'madang agent hooks status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['madang agent hooks status', 'madang agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Madang-managed agent status hooks and remove local hook entries',
    usage: 'madang agent hooks off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['madang agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Madang-managed agent status hooks',
    usage: 'madang agent hooks on [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['madang agent hooks on']
  }
]
