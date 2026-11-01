// Decorate logged errors with a bounded redacted host tail, never telemetry; missing host evidence preserves the original failure.
import { redactString } from '../../observability/redactor'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { MADANGD_LOG_FILENAME } from './madangd-remote-host-support'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import {
  madangdWindowsSlotOpCommand,
  readMadangdWindowsEncodedAnswer
} from './madangd-remote-windows-node'
import { MADANGD_WINDOWS_LOG_TAIL_MARKER } from '../host-state/madangd-windows-host-script'
import type { MadangdRemoteExecTarget } from './madangd-remote-runtime-control'

export const MADANGD_LOG_TAIL_LINES = 40
export const MADANGD_LOG_TAIL_MAX_BYTES = 8 * 1024
// Error decoration must not add an unbounded delay.
const MADANGD_LOG_TAIL_TIMEOUT_MS = 10_000

export function madangdLogTailCommand(host: RemoteHostPlatform, slotDir: string): string {
  const log = joinRemotePath(host, slotDir, MADANGD_LOG_FILENAME)
  if (isWindowsRemoteHost(host)) {
    return madangdWindowsSlotOpCommand(host, slotDir, 'log-tail', [
      log,
      String(MADANGD_LOG_TAIL_MAX_BYTES)
    ])
  }
  return `tail -c ${MADANGD_LOG_TAIL_MAX_BYTES} ${quotePosixShell(log)} 2>/dev/null || true`
}

export function parseMadangdLogTail(host: RemoteHostPlatform, output: string): string | null {
  const raw = isWindowsRemoteHost(host)
    ? (readMadangdWindowsEncodedAnswer(output, MADANGD_WINDOWS_LOG_TAIL_MARKER) ?? '')
    : output
  const bounded = Buffer.from(raw, 'utf8').subarray(-MADANGD_LOG_TAIL_MAX_BYTES).toString('utf8')
  const lines = bounded.replace(/\s+$/u, '').split(/\r?\n/u).slice(-MADANGD_LOG_TAIL_LINES)
  const tail = redactString(lines.join('\n'))
  return tail.trim() ? tail : null
}

async function readMadangdLogTail(
  target: MadangdRemoteExecTarget,
  slotDir: string
): Promise<string | null> {
  try {
    // Observe cancellation failures without reusing the already-aborted request signal.
    const output = await execCommand(target.conn, madangdLogTailCommand(target.host, slotDir), {
      wrapCommand: target.host.commandDialect !== 'powershell',
      timeoutMs: MADANGD_LOG_TAIL_TIMEOUT_MS
    })
    return parseMadangdLogTail(target.host, output)
  } catch (error) {
    console.warn('[ssh] Could not read the madangd.log tail:', error)
    return null
  }
}

export async function withMadangdLogTail(
  target: MadangdRemoteExecTarget,
  slotDir: string,
  message: string
): Promise<string> {
  const tail = await readMadangdLogTail(target, slotDir)
  return tail ? `${message}\nLast lines of madangd.log:\n${tail}` : message
}
