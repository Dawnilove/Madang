/** macOS pins Local Network attribution at spawn: SSH-launched terminals can lose LAN access after sshd-session exits (#25934; Apple TN3179). Record the nearest session plus start time and matching slot PID; preserve earlier attribution while a live terminal daemon survives madangd restarts. */
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { MADANGD_PID_FILENAME } from '../managed-server/install/madangd-remote-host-support'

export const MADANGD_LAUNCH_SSH_SESSION_FILENAME = '.madangd-launch-ssh-session'

const LOCAL_NETWORK_PRIVACY_MAJOR = 15
// Bounds the ancestor walk; real chains are a few processes deep.
const MAX_ANCESTOR_DEPTH = 32

export function recordsMadangdLaunchSshSession(host: RemoteHostPlatform): boolean {
  return host.os === 'darwin'
}

/** Choose the nearest sshd ancestor, which exits with this session; a listener farther up would remain alive. */
export function madangdSshSessionAncestorShellFunction(): string {
  return (
    'madangd_ssh_session() { madangd_sp=$1; madangd_si=0; ' +
    `while [ "$madangd_si" -lt ${MAX_ANCESTOR_DEPTH} ]; do ` +
    'case "$madangd_sp" in "" | *[!0-9]* | 0 | 1) return 1;; esac; ' +
    'madangd_sc=$(ps -o comm= -p "$madangd_sp" 2>/dev/null) || return 1; ' +
    'case "${madangd_sc##*/}" in sshd*) ' +
    'madangd_ss=$(ps -o lstart= -p "$madangd_sp" 2>/dev/null) || return 1; ' +
    // Why unquoted: normalizes lstart's padding so a later read compares equal.
    'echo "$madangd_sp" $madangd_ss; return 0;; esac; ' +
    'madangd_sp=$(ps -o ppid= -p "$madangd_sp" 2>/dev/null | tr -d " "); ' +
    'madangd_si=$((madangd_si + 1)); done; return 1; };'
  )
}

/** Capture before detach without failing launch. */
export function captureMadangdLaunchSshSessionCommand(): string {
  return (
    `${madangdSshSessionAncestorShellFunction()} ` +
    'madangd_session=$(madangd_ssh_session "$$" 2>/dev/null) || madangd_session=;'
  )
}

function recordPath(host: RemoteHostPlatform, userDataDir: string): string {
  return quotePosixShell(joinRemotePath(host, userDataDir, MADANGD_LAUNCH_SSH_SESSION_FILENAME))
}

/** Return 0 for this root's live daemon, 1 for absence, 2 for unreadable argv; PID files alone may name recycled processes. */
function liveDaemonShellFunction(host: RemoteHostPlatform, userDataDir: string): string {
  const daemonDir = quotePosixShell(joinRemotePath(host, userDataDir, 'daemon'))
  return (
    `madangd_daemon_live() { madangd_ddir=${daemonDir}; for madangd_df in "$madangd_ddir"/daemon-v*.pid; do ` +
    '[ -f "$madangd_df" ] || continue; ' +
    'madangd_dp=$(sed -n \'s/.*"pid":\\([0-9][0-9]*\\).*/\\1/p\' "$madangd_df" | head -n 1); ' +
    '[ -n "$madangd_dp" ] || continue; ' +
    'kill -0 "$madangd_dp" 2>/dev/null || continue; ' +
    'madangd_da=$(ps -o args= -p "$madangd_dp" 2>/dev/null); [ -n "$madangd_da" ] || return 2; ' +
    'case "$madangd_da" in *daemon-entry*"$madangd_ddir"* | *"$madangd_ddir"*daemon-entry*) return 0;; esac; ' +
    'done; return 1; };'
  )
}

/** After recording $!, preserve the live daemon's earlier session; otherwise record this launch's session. */
export function writeMadangdLaunchSshSessionCommand(
  host: RemoteHostPlatform,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  return (
    // First-deploy detach may run before madangd creates its data root.
    `{ madangd_bg=$!; ( umask 077; mkdir -p ${quotePosixShell(userDataDir)} ); ` +
    `${liveDaemonShellFunction(host, userDataDir)} ` +
    'madangd_daemon_live; madangd_dl=$?; ' +
    'if [ "$madangd_dl" = 0 ]; then ' +
    `madangd_prev=$(cat ${file}); rm -f ${file}; set -- $madangd_prev; ` +
    `[ "$#" -lt 3 ] || { shift; ( umask 077; echo "$madangd_bg" "$@" > ${file} ); }; ` +
    // Unreadable daemon identity leaves attribution unknown, never assigned to this launch.
    `elif [ "$madangd_dl" = 2 ]; then rm -f ${file}; ` +
    `else rm -f ${file}; [ -z "$madangd_session" ] || ` +
    `( umask 077; echo "$madangd_bg" $madangd_session > ${file} ); fi; :; } 2>/dev/null`
  )
}

export function madangdLaunchSshSessionProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, MADANGD_PID_FILENAME))
  return [
    'madangd_mac=$(sw_vers -productVersion 2>/dev/null) || { echo NOT_APPLICABLE; exit 0; };',
    'madangd_major=${madangd_mac%%.*};',
    'case "$madangd_major" in "" | *[!0-9]*) echo UNVERIFIABLE; exit 0;; esac;',
    `[ "$madangd_major" -ge ${LOCAL_NETWORK_PRIVACY_MAJOR} ] || { echo NOT_APPLICABLE; exit 0; };`,
    `madangd_rec=$(cat ${file} 2>/dev/null) || { echo NOT_RECORDED; exit 0; };`,
    `madangd_pid=$(cat ${pidFile} 2>/dev/null);`,
    'set -- $madangd_rec;',
    'case "$1:$2" in *[!0-9:]* | :* | *:) echo NOT_RECORDED; exit 0;; esac;',
    '[ "$1" = "$madangd_pid" ] || { echo NOT_RECORDED; exit 0; };',
    'madangd_sshd=$2; shift 2; madangd_want=$*;',
    // A ps that can't list this shell can't prove another process absent.
    'ps -o pid= -p "$$" >/dev/null 2>&1 || { echo UNVERIFIABLE; exit 0; };',
    'madangd_now=$(ps -o lstart= -p "$madangd_sshd" 2>/dev/null); madangd_now=$(echo $madangd_now);',
    // A reused PID with another start time is a different process: the session is gone.
    'if [ -z "$madangd_now" ] || [ "$madangd_now" != "$madangd_want" ]; then echo EXITED; else echo LIVE; fi'
  ].join(' ')
}

/** `not-recorded` covers older launches and clients: the condition is unknown, never assumed. */
export type MadangdLaunchSshSession =
  | 'live'
  | 'exited'
  | 'unverifiable'
  | 'not-recorded'
  | 'not-applicable'

export function parseMadangdLaunchSshSession(output: string): MadangdLaunchSshSession {
  switch (output.trim().split('\n').pop()?.trim() ?? '') {
    case 'LIVE':
      return 'live'
    case 'EXITED':
      return 'exited'
    case 'NOT_RECORDED':
      return 'not-recorded'
    case 'NOT_APPLICABLE':
      return 'not-applicable'
    default:
      return 'unverifiable'
  }
}
