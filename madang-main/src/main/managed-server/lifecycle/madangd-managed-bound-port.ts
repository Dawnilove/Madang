// Preferred ports may belong to other runtimes; tunnel to the active slot's published bound port.
import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import type { ServeReadiness } from '../../server/serve-readiness'
import { managedMadangdInstallDir } from './madangd-managed-runtime-context'
import { resolveMadangdRemoteContext } from '../install/madangd-remote-context'
import {
  parseMadangdReadinessWaitOutput,
  readMadangdReadinessNowCommand
} from '../install/madangd-remote-readiness-wait'
import {
  execMadangdRemote,
  type MadangdRemoteExecTarget
} from '../install/madangd-remote-runtime-control'
import type { MadangdHostTarget, MadangdHostTransport } from '../../ssh/madangd-host-transport'

export type MadangdTunnelPortInput = {
  environment: KnownRuntimeEnvironment
  target: SshTarget
  connection: MadangdHostTransport
}

export function madangdBoundPort(readiness: Pick<ServeReadiness, 'boundEndpoint'>): number | null {
  if (!readiness.boundEndpoint) {
    return null
  }
  try {
    const port = Number(new URL(readiness.boundEndpoint).port)
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
  } catch {
    return null
  }
}

async function readManagedMadangdSlotReadiness(
  target: MadangdRemoteExecTarget & { remoteInstallDir: string }
): Promise<ServeReadiness | null> {
  const parsed = parseMadangdReadinessWaitOutput(
    target.host,
    await execMadangdRemote(
      target,
      readMadangdReadinessNowCommand(target.host, target.remoteInstallDir)
    )
  )
  return parsed.state === 'ready' ? parsed.readiness : null
}

export async function readActiveManagedMadangdReadiness(input: {
  target: MadangdHostTarget
  connection: MadangdHostTransport
}): Promise<ServeReadiness | null> {
  const context = await resolveMadangdRemoteContext(input.target, input.connection)
  const active = context.activationRecord.active
  if (!active) {
    return null
  }
  return readManagedMadangdSlotReadiness({
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    remoteInstallDir: managedMadangdInstallDir(context, active)
  })
}

async function readActiveSlotBoundPort(input: MadangdTunnelPortInput): Promise<number | null> {
  if (!input.environment.madangdDeployment) {
    return null
  }
  const readiness = await readActiveManagedMadangdReadiness(input)
  return readiness ? madangdBoundPort(readiness) : null
}

export async function resolveManagedMadangdTunnelPort(input: MadangdTunnelPortInput): Promise<number> {
  const access = getRuntimeSshAccess(input.environment)
  if (!access) {
    throw new Error('Managed madangd environment is missing its SSH tunnel dependency.')
  }
  try {
    return (await readActiveSlotBoundPort(input)) ?? access.remotePort
  } catch (error) {
    // Post-forward identity validation still detects a wrong server when falling back.
    console.warn(
      '[ssh] Could not read the managed Madang server port; trying the preferred one:',
      error
    )
    return access.remotePort
  }
}

/** Missing or unreadable published ports never justify moving an existing tunnel. */
export async function readManagedMadangdPublishedPort(
  input: MadangdTunnelPortInput
): Promise<number | null> {
  try {
    return await readActiveSlotBoundPort(input)
  } catch {
    return null
  }
}
