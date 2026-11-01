/** Reclaim this desktop's exited-holder lock early only with unchanged token/instance and three quiet heartbeats (BUG-23). sshd can outlive the desktop: fence takeover also requires an absent mutation lock, holds it during the steal, and makes admitted mutations recheck ownership. */
import {
  MADANGD_FENCE_OWNER_FILENAME,
  posixMadangdFenceOwnedTest
} from '../managed-server/activation/madangd-activation-fence-scope'
import {
  forgetHeldMadangdFence,
  madangdFenceTokensHeldByExitedProcesses
} from './madangd-held-fence-tokens'
import { readBoundedMadangdRemoteRecord } from '../managed-server/install/madangd-remote-record-file'
import {
  execMadangdRemote,
  type MadangdRemoteExecTarget
} from '../managed-server/install/madangd-remote-runtime-control'
import {
  installMadangdWindowsHostScript,
  madangdWindowsHostOpCommand
} from '../managed-server/install/madangd-remote-windows-node'
import {
  MADANGD_EXITED_OWN_LOCK_QUIET_SECONDS,
  MADANGD_STATE_MUTATION_LOCK_DIRNAME
} from '../managed-server/host-state/madangd-state-snapshot-members'
import { CMD_EXE_COMMAND_LINE_MAX_CHARS } from '../providers/windows-shell-args'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import type { InstallLockExitedOwnerProof } from '../managed-server/install/remote-install-lock'
import { isWindowsRemoteHost, joinRemotePath } from './ssh-remote-platform'

// Bound Windows command length; omitted older tokens simply wait for normal stale-lock arbitration.
const MAX_WINDOWS_CANDIDATES = 16

type ExitedOwnLockScope = { baseDir: string; guardsStateMutation: boolean }

export function exitedOwnLockProof(
  target: MadangdRemoteExecTarget,
  scope: ExitedOwnLockScope
): InstallLockExitedOwnerProof {
  return {
    find: (lockDir) => findExitedOwnLockToken(target, lockDir, scope),
    reclaimed: forgetHeldMadangdFence,
    quietSeconds: MADANGD_EXITED_OWN_LOCK_QUIET_SECONDS,
    mutationLock: mutationLockOf(target, scope) ?? undefined
  }
}

/** Return an exited local holder's token only while the lock still names it; null leaves normal stale-lock arbitration. */
export async function findExitedOwnLockToken(
  target: MadangdRemoteExecTarget,
  lockDir: string,
  scope: ExitedOwnLockScope
): Promise<string | null> {
  const exited = madangdFenceTokensHeldByExitedProcesses()
  if (exited.length === 0) {
    return null
  }
  try {
    const token = isWindowsRemoteHost(target.host)
      ? await findOnWindows(target, lockDir, scope, exited.slice(-MAX_WINDOWS_CANDIDATES))
      : await findOnPosix(target, lockDir, scope, exited)
    return token !== null && exited.includes(token) ? token : null
  } catch {
    // Unanswered: the stale window still applies.
    return null
  }
}

function mutationLockOf(target: MadangdRemoteExecTarget, scope: ExitedOwnLockScope): string | null {
  return scope.guardsStateMutation
    ? joinRemotePath(target.host, scope.baseDir, MADANGD_STATE_MUTATION_LOCK_DIRNAME)
    : null
}

async function findOnPosix(
  target: MadangdRemoteExecTarget,
  lockDir: string,
  scope: ExitedOwnLockScope,
  exited: string[]
): Promise<string | null> {
  const owner = await readBoundedMadangdRemoteRecord(
    target,
    joinRemotePath(target.host, lockDir, MADANGD_FENCE_OWNER_FILENAME),
    64
  )
  const token = owner.state === 'present' ? owner.raw.trim() : ''
  if (!exited.includes(token)) {
    return null
  }
  const command = exitedOwnLockCheckCommand({ lockDir, token }, mutationLockOf(target, scope))
  return (await execMadangdRemote(target, command)).trim() === 'EXITED_OWNER' ? token : null
}

/** Read ownership in the host script so one node.exe invocation returns the proven token. */
async function findOnWindows(
  target: MadangdRemoteExecTarget,
  lockDir: string,
  scope: ExitedOwnLockScope,
  exited: string[]
): Promise<string | null> {
  const command = madangdWindowsHostOpCommand(target.host, scope.baseDir, 'fence-exited-owner', [
    lockDir,
    scope.guardsStateMutation ? '1' : '0',
    ...exited
  ])
  // Overlong sshd/cmd.exe commands cannot prove ownership; retain the normal stale window.
  if (command.length > CMD_EXE_COMMAND_LINE_MAX_CHARS) {
    return null
  }
  await installMadangdWindowsHostScript(target, scope.baseDir)
  const output = await execMadangdRemote(target, command)
  const match = /^EXITED_OWNER (\S+)$/u.exec(output.trim().split(/\r?\n/u).at(-1) ?? '')
  return match ? match[1] : null
}

function exitedOwnLockCheckCommand(
  lock: { lockDir: string; token: string },
  mutationLock: string | null
): string {
  const quiet = (path: string): string =>
    `[ -n "$(find ${path} -maxdepth 0 -mmin +${MADANGD_EXITED_OWN_LOCK_QUIET_SECONDS / 60} 2>/dev/null)" ]`
  return [
    `${posixMadangdFenceOwnedTest(lock)} && ${quiet(quotePosixShell(lock.lockDir))} || exit 0;`,
    ...(mutationLock
      ? [
          // Refuse any mutation lock, matching the steal's absent-lock requirement.
          `[ -e ${quotePosixShell(mutationLock)} ] && exit 0;`
        ]
      : []),
    'echo EXITED_OWNER'
  ].join(' ')
}
