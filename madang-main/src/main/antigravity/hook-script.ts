import { posixCurlCommand } from '../agent-hooks/hook-post-command'
import {
  buildPosixHookPayloadCapture,
  POSIX_HOOK_JSON_STDIN,
  buildPosixHookSpoolLines,
  buildWindowsHookEnvironmentGuardLines
} from '../agent-hooks/hook-stdin-contract'
import { ANTIGRAVITY_PRE_TOOL_USE_DECISION } from './hook-events'

export function getManagedScript(
  target: 'local' | 'posix' = 'local',
  windowsRuntimePath = process.execPath
): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      // Delayed expansion corrupts literal ! characters in paths and hook coordinates.
      'setlocal DisableDelayedExpansion',
      'if /I "%MADANG_ANTIGRAVITY_EVENT%"=="Stop" (',
      '  echo {"decision":""}',
      ') else if /I "%MADANG_ANTIGRAVITY_EVENT%"=="PreToolUse" (',
      `  echo ${ANTIGRAVITY_PRE_TOOL_USE_DECISION}`,
      ') else (',
      '  echo {}',
      ')',
      'if defined MADANG_AGENT_HOOK_ENDPOINT if exist "%MADANG_AGENT_HOOK_ENDPOINT%" call "%MADANG_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      'set "ELECTRON_RUN_AS_NODE=1"',
      `if not defined MADANG_AGENT_HOOK_NODE set "MADANG_AGENT_HOOK_NODE=${windowsRuntimePath.replaceAll('%', '%%')}"`,
      '"%MADANG_AGENT_HOOK_NODE%" "%~dp0antigravity-hook-post.cjs" >nul 2>nul',
      'exit /b 0',
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    'case "$MADANG_ANTIGRAVITY_EVENT" in',
    '  Stop)',
    '    printf \'{"decision":""}\\n\'',
    '    ;;',
    '  PreToolUse)',
    `    printf '${ANTIGRAVITY_PRE_TOOL_USE_DECISION}\\n'`,
    '    ;;',
    '  *)',
    '    printf "{}\\n"',
    '    ;;',
    'esac',
    // Events without stdin still need a status post.
    ...buildPosixHookPayloadCapture('empty-object', POSIX_HOOK_JSON_STDIN),
    ...buildPosixHookSpoolLines('antigravity', 'MADANG_ANTIGRAVITY_EVENT'),
    'if [ -n "$MADANG_AGENT_HOOK_ENDPOINT" ] && [ -r "$MADANG_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$MADANG_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$MADANG_AGENT_HOOK_PORT" ] || [ -z "$MADANG_AGENT_HOOK_TOKEN" ] || [ -z "$MADANG_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    // Keep large payloads off command lines to avoid EDR false positives.
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${MADANG_AGENT_HOOK_PORT}/hook/antigravity" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Orca-Agent-Hook-Token: ${MADANG_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${MADANG_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${MADANG_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${MADANG_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${MADANG_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${MADANG_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${MADANG_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "hook_event_name=${MADANG_ANTIGRAVITY_EVENT}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}

export function getWindowsWrapperScript(eventName: string): string {
  return [
    '@echo off',
    // Preserve literal ! characters in the percent-expanded hooks path.
    'setlocal DisableDelayedExpansion',
    `set "MADANG_ANTIGRAVITY_EVENT=${eventName}"`,
    'set "MADANG_ANTIGRAVITY_CORE=%~dp0antigravity-hook.cmd"',
    'if exist "%MADANG_ANTIGRAVITY_CORE%" (',
    '  call "%MADANG_ANTIGRAVITY_CORE%"',
    '  exit /b 0',
    ')',
    'if /I "%MADANG_ANTIGRAVITY_EVENT%"=="Stop" (',
    '  echo {"decision":""}',
    ') else if /I "%MADANG_ANTIGRAVITY_EVENT%"=="PreToolUse" (',
    `  echo ${ANTIGRAVITY_PRE_TOOL_USE_DECISION}`,
    ') else (',
    '  echo {}',
    ')',
    ...buildWindowsHookEnvironmentGuardLines(),
    'exit /b 0',
    ''
  ].join('\r\n')
}
