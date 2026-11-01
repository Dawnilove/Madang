import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PORTS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ports'],
    summary: 'List the listening ports Madang detected for a workspace',
    usage: 'madang ports [--worktree <selector>] [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'all'],
    notes: [
      'Defaults to the Madang workspace that contains the current directory.',
      'Scans the host the workspace runs on and lists the ports Madang tied to it, by process working directory (match=cwd) or command line (match=command).',
      '--all lists every listener found on that host, including other workspaces and processes Madang could not tie to one. A native folder workspace needs --all, because Madang does not tie ports to folders.',
      'url is the address the dev server printed in a Madang terminal; it is missing when Madang did not see one.'
    ],
    examples: [
      'madang ports',
      'madang ports --worktree branch:feature/login --json',
      'madang ports --all',
      "madang ports --json | jq -r '.result.ports[0].advertisedUrl'"
    ]
  }
]
