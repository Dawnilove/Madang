// Wait on-host in one bounded exec; repeated SSH polling spawned process bursts and triggered Windows EDR.
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import {
  MADANGD_PID_FILENAME,
  MADANGD_PID_MACHINE_FILENAME,
  MADANGD_READINESS_FILENAME,
  MADANGD_READINESS_MAX_BYTES,
  MADANGD_LAUNCH_MACHINE_COMMAND
} from './madangd-remote-host-support'
import {
  parseMadangdReadinessOutput,
  readMadangdReadinessCommand,
  type MadangdReadinessParse
} from './madangd-remote-launch'
import {
  madangdWindowsSlotOpCommand,
  readMadangdWindowsEncodedAnswer
} from './madangd-remote-windows-node'
import { MADANGD_WINDOWS_READINESS_MARKER } from '../host-state/madangd-windows-host-script'

// Stay below the 30-second exec timeout so waits can answer before channel expiry.
export const MADANGD_READINESS_WAIT_MAX_SECONDS = 20

const MADANGD_LAUNCH_EXITED_MARKER = 'MADANGD_LAUNCH_EXITED'

function posixReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const file = quotePosixShell(joinRemotePath(host, remoteInstallDir, MADANGD_READINESS_FILENAME))
  const read = `head -c ${MADANGD_READINESS_MAX_BYTES + 1} ${file} 2>/dev/null`
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, MADANGD_PID_FILENAME))
  const pidMachine = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, MADANGD_PID_MACHINE_FILENAME)
  )
  return [
    // Fail early only on proven exit from the launching machine; shared homes and unverified PIDs must keep waiting.
    `madangd_launch_here() { madangd_recorded=$(cat ${pidMachine} 2>/dev/null) && [ -n "$madangd_recorded" ] && [ "$madangd_recorded" = "$(${MADANGD_LAUNCH_MACHINE_COMMAND} 2>/dev/null)" ]; };`,
    `madangd_launch_exited() { madangd_launch_here || return 1; pid=$(cat ${pidFile} 2>/dev/null); case "$pid" in "" | *[!0-9]*) return 1;; esac;`,
    'probe_error=$(LC_ALL=C kill -0 "$pid" 2>&1) || { case "$probe_error" in *"No such process"*) return 0;; esac; return 1; };',
    'case "$(ps -o stat= -p "$pid" 2>/dev/null)" in Z*) return 0;; esac; return 1; };',
    // Probe fractional sleep once; POSIX hosts may support only integer seconds.
    'if sleep 0.25 2>/dev/null; then madangd_readiness_wait_step=0.25;',
    'else madangd_readiness_wait_step=1; fi;',
    // Bound elapsed time, not iterations: slow filesystem reads otherwise overrun the client exec deadline.
    `madangd_readiness_wait_end=$(($(date +%s) + ${waitSeconds}));`,
    'while [ "$(date +%s)" -lt "$madangd_readiness_wait_end" ]; do',
    `[ "$(${read} | wc -l)" -gt 0 ] && break;`,
    `[ "$(${read} | wc -c)" -gt ${MADANGD_READINESS_MAX_BYTES} ] && break;`,
    `madangd_launch_exited && { echo ${MADANGD_LAUNCH_EXITED_MARKER}; break; };`,
    'sleep "$madangd_readiness_wait_step"; done;',
    `${read} || true`
  ].join(' ')
}

export function madangdReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const seconds = Math.max(0, Math.min(MADANGD_READINESS_WAIT_MAX_SECONDS, Math.ceil(waitSeconds)))
  if (!isWindowsRemoteHost(host)) {
    return posixReadinessWaitCommand(host, remoteInstallDir, seconds)
  }
  return madangdWindowsSlotOpCommand(host, remoteInstallDir, 'readiness-wait', [
    joinRemotePath(host, remoteInstallDir, MADANGD_READINESS_FILENAME),
    String(MADANGD_READINESS_MAX_BYTES),
    String(seconds)
  ])
}

export function parseMadangdReadinessWaitOutput(
  host: RemoteHostPlatform,
  output: string
): MadangdReadinessParse {
  return parseMadangdReadinessOutput(
    isWindowsRemoteHost(host)
      ? (readMadangdWindowsEncodedAnswer(output, MADANGD_WINDOWS_READINESS_MARKER) ?? '')
      : withoutLaunchExitedMarker(output)
  )
}

export function madangdLaunchExitedDuringWait(host: RemoteHostPlatform, output: string): boolean {
  return !isWindowsRemoteHost(host) && output.startsWith(`${MADANGD_LAUNCH_EXITED_MARKER}\n`)
}

function withoutLaunchExitedMarker(output: string): string {
  return output.startsWith(`${MADANGD_LAUNCH_EXITED_MARKER}\n`)
    ? output.slice(MADANGD_LAUNCH_EXITED_MARKER.length + 1)
    : output
}

export function readMadangdReadinessNowCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  // Windows host wait with zero delay substitutes for the unavailable head command.
  return isWindowsRemoteHost(host)
    ? madangdReadinessWaitCommand(host, remoteInstallDir, 0)
    : readMadangdReadinessCommand(host, remoteInstallDir)
}
