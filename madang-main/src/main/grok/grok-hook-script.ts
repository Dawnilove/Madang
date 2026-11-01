import { posixCurlCommand } from '../agent-hooks/hook-post-command'
import { getSharedManagedScriptPath, wrapPosixHookCommand } from '../agent-hooks/installer-utils'
import { wrapWindowsBatchHookCommand } from '../agent-hooks/windows-direct-cmd-hook-command'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  POSIX_HOOK_JSON_STDIN
} from '../agent-hooks/hook-stdin-contract'
import {
  buildWindowsGrokHookScript,
  GROK_HOME_ENVELOPE_MAX_LENGTH
} from './windows-grok-hook-script'

export function getGrokManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'grok-hook.cmd' : 'grok-hook.sh'
}

export function getGrokManagedScriptPath(): string {
  return getSharedManagedScriptPath(getGrokManagedScriptFileName())
}

export function getGrokManagedCommand(scriptPath: string): string {
  // POSIX can gate before spawning because Orca injects MADANG_PANE_KEY only into panes it owns.
  return process.platform === 'win32'
    ? wrapWindowsBatchHookCommand(scriptPath)
    : wrapPosixHookCommand(scriptPath, {}, { requiredEnvVar: 'MADANG_PANE_KEY' })
}

export function getGrokManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return buildWindowsGrokHookScript()
  }

  return [
    '#!/bin/sh',
    ...buildPosixHookPayloadCapture('exit', POSIX_HOOK_JSON_STDIN),
    ...buildPosixHookSpoolLines('grok'),
    'if [ -n "$MADANG_AGENT_HOOK_ENDPOINT" ] && [ -r "$MADANG_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$MADANG_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$MADANG_AGENT_HOOK_PORT" ] || [ -z "$MADANG_AGENT_HOOK_TOKEN" ] || [ -z "$MADANG_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    'grok_home=',
    `if [ -n "\${GROK_HOME:-}" ] && [ "\${#GROK_HOME}" -le ${GROK_HOME_ENVELOPE_MAX_LENGTH} ]; then`,
    '  grok_home=$GROK_HOME',
    'fi',
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${MADANG_AGENT_HOOK_PORT}/hook/grok" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Orca-Agent-Hook-Token: ${MADANG_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${MADANG_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${MADANG_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${MADANG_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${MADANG_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${MADANG_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${MADANG_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "grokHome=${grok_home}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
