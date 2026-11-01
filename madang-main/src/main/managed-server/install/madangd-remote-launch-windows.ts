// Win32-OpenSSH kills session jobs; require native breakaway without WMI/PowerShell, then record PID plus creation time.
import {
  MADANGD_WINDOWS_BREAKAWAY_CONTRACT,
  parseWindowsBreakawayLaunchReport,
  WINDOWS_BREAKAWAY_ENV_FLAG,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
  WINDOWS_BREAKAWAY_STDERR_FLAG,
  WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
  WINDOWS_BREAKAWAY_STDOUT_FLAG
} from '../../../shared/windows-breakaway-launch'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  madangdWindowsNodeCommandLine,
  madangdWindowsSlotOpCommand,
  readMadangdWindowsEncodedAnswer
} from './madangd-remote-windows-node'
import {
  MADANGD_WINDOWS_ENTRY_MARKER,
  MADANGD_WINDOWS_RUNTIME_MARKER
} from '../host-state/madangd-windows-host-script'
import {
  MADANGD_LOG_FILENAME,
  MADANGD_READINESS_FILENAME,
  MADANGD_WINDOWS_PROCESS_FILENAME
} from './madangd-remote-host-support'
import { madangdManagedLaunchEnv, type MadangdLaunchSpec } from './madangd-remote-launch'
import { MADANGD_WINDOWS_LAUNCH_REFUSED_CODE } from '../../madangd/madangd-host-unavailable'

export class MadangdWindowsLaunchRefusedError extends Error {
  readonly code = MADANGD_WINDOWS_LAUNCH_REFUSED_CODE
  constructor(reason: string) {
    super(
      `The Windows host refused to start madangd outside the SSH session (${reason}). madangd needs ` +
        'a job that allows breakaway and a slot with the process-tree launcher; it never falls ' +
        'back to WMI.'
    )
    this.name = 'MadangdWindowsLaunchRefusedError'
  }
}

/** Resolve pinned slot runtime and remove stale instance-stop intent before launch. */
export function windowsMadangdLaunchRuntimeCommand(
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return madangdWindowsSlotOpCommand(host, slotDir, 'slot-runtime', [slotDir, 'clear-stop-request'])
}

export function readWindowsMadangdSlotRuntime(output: string): string {
  const runtime = readMadangdWindowsEncodedAnswer(output, MADANGD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this madangd slot needs.')
  }
  return runtime
}

/** Older host scripts omit entry, implying the legacy single-file launcher. */
export function readWindowsMadangdSlotEntry(
  output: string,
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return (
    readMadangdWindowsEncodedAnswer(output, MADANGD_WINDOWS_ENTRY_MARKER) ??
    joinRemotePath(host, slotDir, 'madangd.js')
  )
}

export function windowsMadangdLaunchCommand(
  host: RemoteHostPlatform,
  spec: MadangdLaunchSpec,
  slotRuntime: string,
  slotEntry = joinRemotePath(host, spec.remoteInstallDir, 'madangd.js')
): string {
  const dir = spec.remoteInstallDir
  return madangdWindowsNodeCommandLine(slotRuntime, [
    slotEntry,
    WINDOWS_BREAKAWAY_LAUNCH_FLAG,
    // CREATE_ALWAYS removes stale readiness before the launcher returns.
    WINDOWS_BREAKAWAY_STDOUT_FLAG,
    joinRemotePath(host, dir, MADANGD_READINESS_FILENAME),
    WINDOWS_BREAKAWAY_STDERR_FLAG,
    joinRemotePath(host, dir, MADANGD_LOG_FILENAME),
    // Preserve previous stderr for crash diagnosis across restart.
    WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
    WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
    joinRemotePath(host, dir, MADANGD_WINDOWS_PROCESS_FILENAME),
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `MADANG_VERSION=${spec.fullVersion}`,
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `MADANG_USER_DATA=${spec.userDataDir}`,
    ...madangdManagedLaunchEnv(spec).flatMap(([name, value]) => [
      WINDOWS_BREAKAWAY_ENV_FLAG,
      `${name}=${value}`
    ]),
    MADANGD_WINDOWS_BREAKAWAY_CONTRACT.argsFlag,
    '--json',
    '--bind',
    spec.bindHost,
    '--port',
    String(spec.port)
  ])
}

/** Return launched PID or surface native-breakaway refusal/failure. */
export function readWindowsMadangdLaunchReport(output: string): number {
  const report = parseWindowsBreakawayLaunchReport(MADANGD_WINDOWS_BREAKAWAY_CONTRACT, output)
  if (report?.method === 'breakaway') {
    return report.pid
  }
  if (report?.method === 'unavailable') {
    throw new MadangdWindowsLaunchRefusedError(
      report.step ? `${report.reason} at ${report.step}` : report.reason
    )
  }
  const detail =
    report?.method === 'failed'
      ? `${report.reason}${report.step ? ` at ${report.step}` : ''} (code ${String(report.code ?? 0)})`
      : 'no launch report'
  throw new Error(`madangd's Windows launcher did not start the candidate: ${detail}.`)
}
