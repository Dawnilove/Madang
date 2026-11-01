// Windows operations use the host script; only POSIX command builders use this guard.
import { isWindowsRemoteHost, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

export class MadangdRemoteLaunchUnsupportedError extends Error {
  readonly code = 'madangd_remote_launch_unsupported_host'
  constructor(hostLabel: string) {
    super(
      `This madangd command does not run on a ${hostLabel} host. The install transaction is ` +
        'host-agnostic, but this step is a POSIX command with a separate Windows path.'
    )
    this.name = 'MadangdRemoteLaunchUnsupportedError'
  }
}

export function assertPosixMadangdHost(host: RemoteHostPlatform): void {
  if (isWindowsRemoteHost(host)) {
    throw new MadangdRemoteLaunchUnsupportedError('Windows')
  }
}

/** Candidate stdout containing readiness; bounded below even if other output follows. */
export const MADANGD_READINESS_FILENAME = '.madangd-readiness'
export const MADANGD_LOG_FILENAME = 'madangd.log'
// Candidate stdout is untrusted in size; never read runaway output whole.
export const MADANGD_READINESS_MAX_BYTES = 256 * 1024

export const MADANGD_PID_FILENAME = '.madangd-pid'
/** Pair the PID with boot ID and node name; shared home paths cannot identify a machine. */
export const MADANGD_PID_MACHINE_FILENAME = `${MADANGD_PID_FILENAME}-machine`
/** Emit nothing without a boot ID; launch and later wait compare this identity. */
export const MADANGD_LAUNCH_MACHINE_COMMAND = 'cat /proc/sys/kernel/random/boot_id&&uname -n'

/** Windows pairs PID with creation time because PID reuse alone cannot identify the process. */
export const MADANGD_WINDOWS_PROCESS_FILENAME = '.madangd-process.json'

/** kill -0 includes zombies; ps excludes them, while missing evidence conservatively retains the process. */
export function posixProcessAliveShellFunction(
  options: { refuseUnverifiable?: boolean } = {}
): string {
  // Destructive lifecycle steps need explicit absence; permission failures cannot prove exit.
  const probe = options.refuseUnverifiable
    ? 'probe_error=$(LC_ALL=C kill -0 "$1" 2>&1) || { ' +
      'case "$probe_error" in *"No such process"*) return 1;; ' +
      '*) echo UNKNOWN; exit 0;; esac; }; '
    : 'kill -0 "$1" 2>/dev/null || return 1; '
  return (
    `madangd_alive() { ${probe}` +
    'case "$(ps -o stat= -p "$1" 2>/dev/null)" in Z*) return 1;; esac; return 0; };'
  )
}
