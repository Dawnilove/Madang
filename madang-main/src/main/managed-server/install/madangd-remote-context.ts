import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import type { SshTarget } from '../../../shared/ssh-types'
import type { MadangdActivationRecord } from '../activation/madangd-activation-record'
import { readMadangdActivationRecord } from '../activation/madangd-activation-record-store'
import { resolveMadangdRuntimeTarget } from '../lifecycle/madangd-runtime-target'
import { prepareWindowsMadangdHost } from '../host-state/madangd-windows-host-preparation'
import {
  isWslMadangdHostTarget,
  type MadangdHostTarget,
  type MadangdHostTransport
} from '../../ssh/madangd-host-transport'
import {
  decideMadangdMachineHome,
  madangdMachineDataRoot,
  madangdMachineHomeDir,
  madangdMachineHomeProbeCommand,
  madangdMachineOwnershipUnresolvedMessage,
  parseMadangdMachineHomeProbe
} from '../host-state/madangd-machine-home'
import {
  madangdMachineClaimCommand,
  readMadangdMachineClaimAnswer
} from '../host-state/madangd-machine-claim-command'
import { execMadangdRemote, type MadangdRemoteExecTarget } from './madangd-remote-runtime-control'
import { readRemoteHomeCommand } from '../../ssh/ssh-remote-commands'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeRemoteHome,
  validateRemoteHome,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/ssh-remote-platform-detection'
import { MadangdHostUnsupportedError } from '../../madangd/madangd-host-unavailable'
import { rememberSshHostPlatform } from '../../ssh/ssh-host-platform-memo'

/** Default SSH generic retains compatibility with lifecycle consumers requiring SSH-only fields. */
export type MadangdRemoteContext<Target extends MadangdHostTarget = SshTarget> = {
  activationRecord: MadangdActivationRecord
  /** Select a compatible runtime when host glibc is below the default pin's floor. */
  serverTarget: NodeRuntimeTarget
  connection: MadangdHostTransport
  host: RemoteHostPlatform
  /** Login or machine-specific home for shared-home isolation; userDataDir must follow the same owner. */
  remoteHome: string
  target: Target
  userDataDir: string
}

export async function resolveMadangdRemoteContext<Target extends MadangdHostTarget = SshTarget>(
  target: Target,
  connection: MadangdHostTransport,
  signal?: AbortSignal,
  detectedHost?: RemoteHostPlatform
): Promise<MadangdRemoteContext<Target>> {
  const host = detectedHost ?? (await detectRemoteHostPlatform(connection, { signal }))
  if (!host) {
    throw new MadangdHostUnsupportedError('Madang’s server doesn’t support this SSH host’s platform.')
  }
  const remote = { conn: connection, host, signal }
  const { madangdHome: remoteHome, userDataDir } = await resolveMadangdMachineHome(
    remote,
    !isWslMadangdHostTarget(target)
  )
  const serverTarget = await resolveMadangdRuntimeTarget({
    conn: connection,
    host,
    signal
  })
  if (!isWslMadangdHostTarget(target)) {
    rememberSshHostPlatform(target.id, host, serverTarget)
  }
  if (isWindowsRemoteHost(host)) {
    // Prepare pinned Node before even reading activation state on Windows.
    await prepareWindowsMadangdHost({
      conn: connection,
      host,
      remoteHome,
      serverTarget,
      signal
    })
  }
  const activationRecord = await readMadangdActivationRecord({
    ...remote,
    remoteHome
  })
  return {
    activationRecord,
    serverTarget,
    connection,
    host,
    remoteHome,
    target,
    userDataDir
  }
}

/** Resolve per-machine state for shared POSIX homes; Windows and WSL retain login-home placement. */
export async function resolveMadangdMachineHome(
  remote: MadangdRemoteExecTarget,
  keyByMachine: boolean
): Promise<{ loginHome: string; madangdHome: string; userDataDir: string }> {
  const { host } = remote
  if (!keyByMachine || isWindowsRemoteHost(host)) {
    const loginHome = normalizeRemoteHome(
      await execMadangdRemote(remote, readRemoteHomeCommand(host)),
      host
    )
    if (!validateRemoteHome(loginHome, host)) {
      throw new Error(`Remote home is not a valid path: ${loginHome.slice(0, 100)}`)
    }
    return {
      loginHome,
      madangdHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.madang')
    }
  }
  const probe = parseMadangdMachineHomeProbe(
    await execMadangdRemote(remote, madangdMachineHomeProbeCommand(host)),
    host
  )
  const { loginHome } = probe
  let decision = decideMadangdMachineHome(probe, host)
  if (decision.kind === 'unresolved') {
    throw new Error(
      madangdMachineOwnershipUnresolvedMessage(
        decision.machineKey,
        probe.identity?.hostname ?? null,
        decision.cause
      )
    )
  }
  if (decision.kind === 'claim') {
    const won = readMadangdMachineClaimAnswer(
      await execMadangdRemote(remote, madangdMachineClaimCommand(host, loginHome, decision.machineKey))
    )
    if (won.state !== 'present') {
      throw new Error(won.message)
    }
    decision =
      won.machineKey === decision.machineKey
        ? { kind: 'login-home' }
        : { kind: 'machine-home', machineKey: decision.machineKey }
  }
  if (decision.kind === 'login-home') {
    return {
      loginHome,
      madangdHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.madang')
    }
  }
  const madangdHome = madangdMachineHomeDir(host, loginHome, decision.machineKey)
  await execMadangdRemote(remote, `umask 077; mkdir -p ${quotePosixShell(madangdHome)}`)
  return {
    loginHome,
    madangdHome,
    userDataDir: madangdMachineDataRoot(host, loginHome, decision.machineKey)
  }
}
