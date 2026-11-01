import { posixCurlCommand } from '../agent-hooks/hook-post-command'
import {
  buildWindowsAgentHookPostCommand,
  getSharedManagedScriptPath
} from '../agent-hooks/installer-utils'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  buildWindowsHookEnvironmentGuardLines
} from '../agent-hooks/hook-stdin-contract'

export function getManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'copilot-hook.cmd' : 'copilot-hook.sh'
}

export function getManagedScriptPath(): string {
  return getSharedManagedScriptPath(getManagedScriptFileName())
}

export function getManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Why: Copilot consumes stdout for some hooks, so answer before any guard can exit.
      'echo {}',
      // Why: the direct registration passes the event as %1; the encoded fallback sets the env var.
      'if not "%~1"=="" set "MADANG_COPILOT_HOOK_EVENT=%~1"',
      // Why: refresh endpoint coordinates for PTYs surviving an Orca restart.
      'if defined MADANG_AGENT_HOOK_ENDPOINT if exist "%MADANG_AGENT_HOOK_ENDPOINT%" call "%MADANG_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      buildWindowsAgentHookPostCommand('copilot', [
        '  --data-urlencode "hookEventName=%MADANG_COPILOT_HOOK_EVENT%" ^'
      ]),
      'exit /b 0',
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    "printf '{}\\n'",
    ...buildPosixHookPayloadCapture(),
    ...buildPosixHookSpoolLines('copilot'),
    // Answer Copilot before endpoint refresh, stdin parsing or posting can fail.
    'if [ -n "$MADANG_AGENT_HOOK_ENDPOINT" ] && [ -r "$MADANG_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$MADANG_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$MADANG_AGENT_HOOK_PORT" ] || [ -z "$MADANG_AGENT_HOOK_TOKEN" ] || [ -z "$MADANG_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    // Keep large tool payloads off curl's command line to avoid EDR false positives.
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${MADANG_AGENT_HOOK_PORT}/hook/copilot" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Orca-Agent-Hook-Token: ${MADANG_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${MADANG_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${MADANG_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${MADANG_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${MADANG_WORKTREE_ID}" \\',
    '  --data-urlencode "hookEventName=${MADANG_COPILOT_HOOK_EVENT}" \\',
    '  --data-urlencode "env=${MADANG_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${MADANG_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
