import { getManagedMadangdFenceEnvironmentId } from '../../../shared/managed-madangd-ssh-owner'
import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment,
  type RuntimeSshTunnelLink
} from '../../../shared/runtime-environments'
import type { PortForwardEntry, SshTarget } from '../../../shared/ssh-types'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { adoptSshConnection } from '../../ssh/connection/ssh-connection-attribution'
import type { SshConnectionManager } from '../../ssh/connection/ssh-connection-manager'
import type { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import type { SshPortForwardManager } from '../../ssh/port-forwarding/ssh-port-forward'

export type ActiveMadangdTunnel = {
  connection: SshConnection
  forwardId: string
  localPort: number
  /** Bound port may differ from the persisted preferred port. */
  remotePort: number
  preferredPort: number
  sshTargetGeneration: number
  targetId: string
  transportGeneration: number
}

type ManagedTunnelExpectation = {
  environmentId: string
  sshTargetId: string
  sshTargetGeneration: number
  localPort: number
  remotePort: number
}

export function managedTunnelAccess(
  environment: KnownRuntimeEnvironment | null | undefined,
  target: SshTarget | null | undefined,
  expected: ManagedTunnelExpectation
): RuntimeSshTunnelLink | null {
  const access = environment ? getRuntimeSshAccess(environment) : undefined
  return environment?.id === expected.environmentId &&
    environment.connectionDependency === 'ssh-tunnel' &&
    access?.sshTargetId === expected.sshTargetId &&
    access.sshTargetGeneration === expected.sshTargetGeneration &&
    access.localPort === expected.localPort &&
    access.remotePort === expected.remotePort &&
    target?.generation === expected.sshTargetGeneration &&
    getManagedMadangdFenceEnvironmentId(target) === expected.environmentId
    ? access
    : null
}

export function managedTunnelStillPaired(
  built: KnownRuntimeEnvironment,
  current: KnownRuntimeEnvironment | null,
  target: SshTarget | null | undefined,
  expected: ManagedTunnelExpectation
): boolean {
  return (
    current?.runtimeId === built.runtimeId &&
    (current.pairingRevision ?? current.createdAt) === (built.pairingRevision ?? built.createdAt) &&
    managedTunnelAccess(current, target, expected) !== null
  )
}

export function resolveManagedTunnelBinding(
  environment: KnownRuntimeEnvironment,
  dependencies: {
    getConnectionManager: () => SshConnectionManager | null
    getTargetStore: () => ReturnType<typeof getSshTargetRegistryStore>
  }
): {
  deployment: RuntimeSshTunnelLink
  targetStore: NonNullable<ReturnType<typeof getSshTargetRegistryStore>>
  connectionManager: SshConnectionManager
  target: SshTarget
} {
  const deployment = getRuntimeSshAccess(environment)
  if (!deployment || environment.connectionDependency !== 'ssh-tunnel') {
    throw new Error('Managed madangd environment is missing its SSH tunnel dependency.')
  }
  const targetStore = dependencies.getTargetStore()
  const connectionManager = dependencies.getConnectionManager()
  if (!targetStore || !connectionManager) {
    throw new Error('SSH is unavailable on this client; this host’s Madang server is unverifiable.')
  }
  const target = targetStore.getTarget(deployment.sshTargetId)
  if (!target || target.generation !== deployment.sshTargetGeneration) {
    throw new Error('The SSH registration for this host’s Madang server was removed or re-created.')
  }
  if (getManagedMadangdFenceEnvironmentId(target) !== environment.id) {
    throw new Error('The SSH target is no longer owned by this host’s Madang server.')
  }
  return { deployment, targetStore, connectionManager, target }
}

/** Delete the record only if a successor has not replaced this tunnel. */
export async function dropActiveMadangdTunnel(
  active: Map<string, ActiveMadangdTunnel>,
  forwards: SshPortForwardManager,
  environmentId: string,
  entry: ActiveMadangdTunnel
): Promise<void> {
  await forwards.removeForwardAndWait(entry.forwardId)
  if (active.get(environmentId) === entry) {
    active.delete(environmentId)
  }
}

export function activeTunnelMatches(
  active: ActiveMadangdTunnel | undefined,
  current: {
    connection: SshConnection
    transportGeneration: number
    target: SshTarget
    deployment: RuntimeSshTunnelLink
  }
): boolean {
  return (
    active?.connection === current.connection &&
    active.transportGeneration === current.transportGeneration &&
    active.targetId === current.target.id &&
    active.sshTargetGeneration === current.target.generation &&
    active.localPort === current.deployment.localPort &&
    active.preferredPort === current.deployment.remotePort
  )
}

export function recordActiveMadangdTunnel(
  active: Map<string, ActiveMadangdTunnel>,
  environmentId: string,
  forward: PortForwardEntry,
  tunnel: Omit<ActiveMadangdTunnel, 'forwardId' | 'localPort' | 'remotePort'>
): void {
  // Adopt the transport so cancellation of its original connect cannot close this tunnel.
  adoptSshConnection(tunnel.connection)
  active.set(environmentId, {
    ...tunnel,
    forwardId: forward.id,
    localPort: forward.localPort,
    remotePort: forward.remotePort
  })
}

/** Superseded builds must not report success. */
class MadangdTunnelSupersededError extends Error {
  constructor() {
    super('Madang SSH tunnel setup was superseded.')
    this.name = 'MadangdTunnelSupersededError'
  }
}

export function supersededTunnelError(): Error {
  return new MadangdTunnelSupersededError()
}
