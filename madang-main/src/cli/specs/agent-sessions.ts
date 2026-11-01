import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_SESSIONS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'sessions'],
    summary: 'List the chat sessions Madang knows, with their real conversation names',
    usage: 'madang agent sessions [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Each row starts with the session address orca_session_id:<id>. To give a task to one of these open chats, pass that address as --terminal to `orchestration worker-start` (with --worktree set to the chat workspace), or as --to to `orchestration dispatch`.',
      'Rows marked asleep are saved chats whose agent is not running.'
    ],
    examples: ['madang agent sessions', 'madang agent sessions --json']
  }
]
