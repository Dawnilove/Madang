import { posixCurlCommand } from '../agent-hooks/hook-post-command'
import { WINDOWS_HOOK_STDIN_READER } from '../agent-hooks/hook-stdin-contract'
import {
  CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS,
  CLAUDE_STATUSLINE_PATHNAME
} from '../../shared/claude-statusline-rate-limits'
import { wrapWindowsDirectCmdHookCommand } from '../agent-hooks/windows-direct-cmd-hook-command'
import { getManagedCommand } from './hook-settings'

const STATUSLINE_CLEANUP_LABEL = 'orca_statusline_cleanup'
const STATUSLINE_PROBE_LABEL = 'orca_statusline_probe'

// PowerShell needs a bare safe path; unsafe paths keep runtime HOME to avoid per-tick PowerShell spawns.
export function getManagedStatusLineCommand(scriptPath: string): string {
  return (
    (process.platform === 'win32' ? wrapWindowsDirectCmdHookCommand(scriptPath) : null) ??
    getManagedCommand(scriptPath)
  )
}

// Forward live usage without OAuth polling; emit no stdout to preserve the terminal statusline.
export function getManagedStatusLineScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Daemon workers inherit stale pane keys; exit before reading their potentially abandoned stdin.
      'if not "%CLAUDE_JOB_DIR%"=="" exit /b 0',
      // Endpoint refresh never sets the pane key, so this guard can precede stdin capture.
      'if "%MADANG_PANE_KEY%"=="" exit /b 0',
      // UUID suffixes and sanitized legacy delimiters keep filenames safe.
      'set "MADANG_STATUSLINE_PANE_ID=%MADANG_PANE_KEY:~-36%"',
      'set "MADANG_STATUSLINE_PANE_ID=%MADANG_STATUSLINE_PANE_ID::=_%"',
      // Buffer before spawning curl; per-pane names avoid same-second %RANDOM% collisions.
      'set "MADANG_STATUSLINE_PAYLOAD_FILE=%TEMP%\\orca-claude-statusline-%MADANG_STATUSLINE_PANE_ID%.tmp"',
      `${WINDOWS_HOOK_STDIN_READER} >"%MADANG_STATUSLINE_PAYLOAD_FILE%" 2>nul`,
      // Builtin throttling avoids findstr and curl spawns on streaming ticks.
      'set "MADANG_STATUSLINE_STAMP_FILE=%TEMP%\\orca-claude-statusline-last-%MADANG_STATUSLINE_PANE_ID%.tmp"',
      'set "MADANG_STATUSLINE_NOW="',
      'set "MADANG_STATUSLINE_TIME=%TIME: =0%"',
      'for /f "tokens=1-3 delims=:.," %%a in ("%MADANG_STATUSLINE_TIME%") do set /a "MADANG_STATUSLINE_NOW=(1%%a %% 100)*3600+(1%%b %% 100)*60+(1%%c %% 100)" 2>nul',
      'set "MADANG_STATUSLINE_LAST="',
      'set "MADANG_STATUSLINE_ELAPSED="',
      'if exist "%MADANG_STATUSLINE_STAMP_FILE%" set /p MADANG_STATUSLINE_LAST=<"%MADANG_STATUSLINE_STAMP_FILE%"',
      'if defined MADANG_STATUSLINE_LAST for /f "delims=0123456789" %%d in ("%MADANG_STATUSLINE_LAST%") do set "MADANG_STATUSLINE_LAST="',
      'if defined MADANG_STATUSLINE_NOW if defined MADANG_STATUSLINE_LAST set /a "MADANG_STATUSLINE_ELAPSED=MADANG_STATUSLINE_NOW-MADANG_STATUSLINE_LAST" 2>nul',
      `if not defined MADANG_STATUSLINE_ELAPSED goto :${STATUSLINE_PROBE_LABEL}`,
      `if %MADANG_STATUSLINE_ELAPSED% GEQ 0 if %MADANG_STATUSLINE_ELAPSED% LSS ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS} goto :${STATUSLINE_CLEANUP_LABEL}`,
      `:${STATUSLINE_PROBE_LABEL}`,
      // Non-subscriber payloads lack rate_limits; skip their endpoint lookup and curl spawn.
      // Escaped quotes match the JSON key, avoiding false matches in paths.
      '"%SystemRoot%\\System32\\findstr.exe" /c:\\"rate_limits\\" "%MADANG_STATUSLINE_PAYLOAD_FILE%" >nul 2>nul',
      `if errorlevel 1 goto :${STATUSLINE_CLEANUP_LABEL}`,
      // Refresh stale endpoint coordinates after Orca restarts, falling back to PTY env.
      'if defined MADANG_AGENT_HOOK_ENDPOINT if exist "%MADANG_AGENT_HOOK_ENDPOINT%" call "%MADANG_AGENT_HOOK_ENDPOINT%" 2>nul',
      `if "%MADANG_AGENT_HOOK_PORT%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
      `if "%MADANG_AGENT_HOOK_TOKEN%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
      // Stamp only eligible posts so skipped ticks never postpone the next post.
      'if defined MADANG_STATUSLINE_NOW (>"%MADANG_STATUSLINE_STAMP_FILE%" echo %MADANG_STATUSLINE_NOW%)',
      // An always-defined field posts empty configDir when unset, rather than a literal %VAR%.
      'set "MADANG_STATUSLINE_CONFIG_DIR_FIELD=configDir="',
      'if defined CLAUDE_CONFIG_DIR set "MADANG_STATUSLINE_CONFIG_DIR_FIELD=configDir=%CLAUDE_CONFIG_DIR%"',
      [
        '"%SystemRoot%\\System32\\curl.exe" -sS -X POST',
        `"http://127.0.0.1:%MADANG_AGENT_HOOK_PORT%${CLAUDE_STATUSLINE_PATHNAME}"`,
        '--connect-timeout 0.5 --max-time 1.5',
        '-H "Content-Type: application/x-www-form-urlencoded"',
        '-H "X-Orca-Agent-Hook-Token: %MADANG_AGENT_HOOK_TOKEN%"',
        '--data-urlencode "paneKey=%MADANG_PANE_KEY%"',
        '--data-urlencode "%MADANG_STATUSLINE_CONFIG_DIR_FIELD%"',
        '--data-urlencode "env=%MADANG_AGENT_HOOK_ENV%"',
        '--data-urlencode "version=%MADANG_AGENT_HOOK_VERSION%"',
        '--data-urlencode "payload@%MADANG_STATUSLINE_PAYLOAD_FILE%"',
        '>nul 2>&1'
      ].join(' '),
      `:${STATUSLINE_CLEANUP_LABEL}`,
      'del "%MADANG_STATUSLINE_PAYLOAD_FILE%" >nul 2>nul',
      'exit /b 0',
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    // Builtin capture avoids per-tick cat spawns.
    'payload=',
    'while IFS= read -r orca_statusline_line || [ -n "$orca_statusline_line" ]; do',
    '  payload="${payload}${orca_statusline_line}\n"',
    'done',
    'payload=${payload%?}',
    'if [ -z "$payload" ]; then',
    '  exit 0',
    'fi',
    // Daemon workers inherit stale pane keys; POSIX must capture stdin first to avoid agent EPIPE.
    'if [ -n "$CLAUDE_JOB_DIR" ]; then',
    '  exit 0',
    'fi',
    // Non-subscriber payloads lack rate_limits; avoid spawning curl for them.
    'case "$payload" in',
    '  *\'"rate_limits"\'*) ;;',
    '  *) exit 0 ;;',
    'esac',
    'if [ -n "$MADANG_AGENT_HOOK_ENDPOINT" ] && [ -r "$MADANG_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$MADANG_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$MADANG_AGENT_HOOK_PORT" ] || [ -z "$MADANG_AGENT_HOOK_TOKEN" ] || [ -z "$MADANG_PANE_KEY" ]; then',
    '  exit 0',
    'fi',
    // The stable leaf UUID excludes path-unsafe and overlong tab IDs.
    'orca_statusline_pane_id=${MADANG_PANE_KEY##*:}',
    // Legacy numeric leaf IDs were tab-local; include a safe tab ID to isolate their stamps.
    'case "$orca_statusline_pane_id" in',
    "  ''|*[!0-9]*) ;;",
    '  *)',
    '    orca_statusline_tab_id=${MADANG_PANE_KEY%:*}',
    '    case "$orca_statusline_tab_id" in',
    "      ''|*[!A-Za-z0-9._-]*) ;;",
    '      *) orca_statusline_pane_id="${orca_statusline_tab_id}_${orca_statusline_pane_id}" ;;',
    '    esac',
    '    ;;',
    'esac',
    'orca_statusline_stamp="${TMPDIR:-/tmp}/orca-claude-statusline-last-${orca_statusline_pane_id}"',
    // Use the payload clock to avoid per-tick date spawns; fall back if the schema changes.
    'orca_statusline_now=',
    'case "$payload" in',
    '  *\'"total_duration_ms"\'*)',
    '    orca_statusline_duration=${payload#*\'"total_duration_ms"\'}',
    '    orca_statusline_duration=${orca_statusline_duration#*:}',
    '    orca_statusline_duration=${orca_statusline_duration#"${orca_statusline_duration%%[![:space:]]*}"}',
    '    orca_statusline_duration=${orca_statusline_duration%%[!0-9]*}',
    '    case "$orca_statusline_duration" in',
    '      0|[1-9]|[1-9][0-9]*)',
    '        if [ "${#orca_statusline_duration}" -le 15 ]; then',
    '          orca_statusline_now=$((orca_statusline_duration / 1000))',
    '        fi',
    '        ;;',
    '    esac',
    '    ;;',
    'esac',
    'if [ -z "$orca_statusline_now" ]; then',
    '  orca_statusline_now=$(date +%s 2>/dev/null) || orca_statusline_now=',
    'fi',
    // Canonical decimals avoid fatal dash octal errors (008); malformed stamps must fail open.
    'case "$orca_statusline_now" in 0|[1-9]|[1-9][0-9]*) ;; *) orca_statusline_now= ;; esac',
    'if [ -n "$orca_statusline_now" ] && [ -f "$orca_statusline_stamp" ]; then',
    '  orca_statusline_last=',
    '  IFS= read -r orca_statusline_last <"$orca_statusline_stamp" 2>/dev/null || :',
    '  case "$orca_statusline_last" in 0|[1-9]|[1-9][0-9]*) ;; *) orca_statusline_last= ;; esac',
    '  if [ "${#orca_statusline_last}" -gt 15 ]; then orca_statusline_last=; fi',
    '  if [ -n "$orca_statusline_last" ]; then',
    '    orca_statusline_elapsed=$((orca_statusline_now - orca_statusline_last))',
    `    if [ "$orca_statusline_elapsed" -ge 0 ] && [ "$orca_statusline_elapsed" -lt ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS} ]; then`,
    '      exit 0',
    '    fi',
    '  fi',
    'fi',
    'if [ -n "$orca_statusline_now" ]; then',
    '  printf \'%s\' "$orca_statusline_now" >"$orca_statusline_stamp" 2>/dev/null || :',
    'fi',
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${MADANG_AGENT_HOOK_PORT}${CLAUDE_STATUSLINE_PATHNAME}" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Orca-Agent-Hook-Token: ${MADANG_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${MADANG_PANE_KEY}" \\',
    '  --data-urlencode "configDir=${CLAUDE_CONFIG_DIR}" \\',
    '  --data-urlencode "env=${MADANG_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${MADANG_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || true',
    'exit 0',
    ''
  ].join('\n')
}
