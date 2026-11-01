import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { isAuthError } from '../../ssh/ssh-reconnect-error-classification'
import type { SshConnectionManager } from '../../ssh/connection/ssh-connection-manager'
import { SshPortForwardManager } from '../../ssh/port-forwarding/ssh-port-forward'
import { MadangdManagedTunnelTransportProvider } from './madangd-managed-tunnel-transport'
import {
  MadangdManagedTunnelResumeRecovery,
  type MadangdManagedServingCheck,
  type MadangdManagedTunnelProbe,
  type MadangdManagedTunnelResumeOptions
} from './madangd-managed-tunnel-resume'
import type { MadangdManagedServing } from './madangd-managed-serving'
import {
  activeTunnelMatches,
  dropActiveMadangdTunnel,
  managedTunnelStillPaired,
  recordActiveMadangdTunnel,
  resolveManagedTunnelBinding,
  supersededTunnelError,
  type ActiveMadangdTunnel
} from './madangd-managed-tunnel-active'
import { checkManagedTunnelServing, type MadangdTunnelServing } from './madangd-managed-tunnel-serving'
import type { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import {
  environmentForwardChecks,
  forwardToVerifiedMadangd,
  PERSISTED_PORT_TARGETING,
  type MadangdManagedTunnelTargeting,
  type MadangdTunnelStartChecks
} from './madangd-managed-tunnel-target'

type MadangdManagedTunnelDependencies = {
  getConnectionManager: () => SshConnectionManager | null
  getTargetStore: () => ReturnType<typeof getSshTargetRegistryStore>
  forwardManager?: SshPortForwardManager
  probeTunnel?: MadangdManagedTunnelProbe
  targeting?: MadangdManagedTunnelTargeting
  /** Start proven-stopped servers after a fresh forward opens. */
  ensureServing?: MadangdManagedServingCheck
}

export class MadangdManagedTunnelManager {
  private readonly active = new Map<string, ActiveMadangdTunnel>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly ownershipGenerations = new Map<string, number>()
  // Track in-flight build targets so Disconnect can supersede unrecorded forwards.
  private readonly buildTargets = new Map<string, string>()
  private readonly forwards: SshPortForwardManager
  private readonly resumeRecovery: MadangdManagedTunnelResumeRecovery
  private readonly targeting: MadangdManagedTunnelTargeting
  private managerGeneration = 0

  constructor(private readonly dependencies: MadangdManagedTunnelDependencies) {
    this.forwards =
      dependencies.forwardManager ??
      new SshPortForwardManager({}, [new MadangdManagedTunnelTransportProvider()])
    this.targeting = dependencies.targeting ?? PERSISTED_PORT_TARGETING
    this.resumeRecovery = new MadangdManagedTunnelResumeRecovery({
      active: this.active,
      forwards: this.forwards,
      getConnectionManager: dependencies.getConnectionManager,
      getManagerGeneration: () => this.managerGeneration,
      getTargetStore: dependencies.getTargetStore,
      inFlight: this.inFlight,
      ownershipGenerations: this.ownershipGenerations,
      probeTunnel: dependencies.probeTunnel,
      targeting: this.targeting,
      checkServing: (environment) => this.checkServing(environment)
    })
    this.forwards.setCallbacks({
      onForwardClosed: (entry) => {
        for (const [environmentId, active] of this.active) {
          if (active.forwardId === entry.id) {
            this.active.delete(environmentId)
          }
        }
      }
    })
  }

  ensure(
    environment: KnownRuntimeEnvironment,
    resolveCurrent: () => KnownRuntimeEnvironment | null = () => environment,
    retryJoined = true
  ): Promise<void> {
    if (!getRuntimeSshAccess(environment)) {
      return Promise.resolve()
    }
    const pending = this.inFlight.get(environment.id)
    if (pending) {
      // Retry joined runs cancelled by another caller; authentication failures remain authoritative.
      return pending.catch((error: unknown) =>
        retryJoined && !(error instanceof Error && isAuthError(error))
          ? this.ensure(environment, resolveCurrent, false)
          : Promise.reject(error)
      )
    }
    const operation = this.ensureManagedTunnel(environment, resolveCurrent).finally(() => {
      if (this.inFlight.get(environment.id) === operation) {
        this.inFlight.delete(environment.id)
      }
    })
    this.inFlight.set(environment.id, operation)
    return operation
  }

  async rebuild(
    environment: KnownRuntimeEnvironment,
    resolveCurrent: () => KnownRuntimeEnvironment | null = () => environment
  ): Promise<void> {
    await this.inFlight.get(environment.id)?.catch(() => undefined)
    const active = this.active.get(environment.id)
    if (active) {
      await dropActiveMadangdTunnel(this.active, this.forwards, environment.id, active)
    }
    await this.ensure(environment, resolveCurrent)
  }

  async start(
    environmentId: string,
    target: SshTarget,
    connection: SshConnection,
    remotePort: number,
    checks: MadangdTunnelStartChecks = {}
  ): Promise<number> {
    if (!target.generation) {
      throw new Error('Managed Madang SSH target has no registration generation.')
    }
    this.buildTargets.set(environmentId, target.id)
    const managerGeneration = this.managerGeneration
    const ownershipGeneration = (this.ownershipGenerations.get(environmentId) ?? 0) + 1
    const transportGeneration = connection.getConnectGeneration()
    const stillCurrent = (): boolean =>
      this.managerGeneration === managerGeneration &&
      this.ownershipGenerations.get(environmentId) === ownershipGeneration &&
      connection.getConnectGeneration() === transportGeneration
    await this.close(environmentId)
    if (!stillCurrent()) {
      throw supersededTunnelError()
    }
    const forward = await forwardToVerifiedMadangd({
      targetId: target.id,
      connection,
      forwards: this.forwards,
      localPort: 0,
      label: 'Madang on this host',
      remotePort,
      rereadRemotePort: checks.rereadRemotePort,
      verify: checks.verify,
      stillCurrent
    })
    // Teardown may occur between the build's last check and recording its forward.
    if (!forward || !stillCurrent()) {
      await (forward && this.forwards.removeForwardAndWait(forward.id))
      throw supersededTunnelError()
    }
    recordActiveMadangdTunnel(this.active, environmentId, forward, {
      connection,
      preferredPort: checks.preferredPort ?? remotePort,
      sshTargetGeneration: target.generation,
      targetId: target.id,
      transportGeneration
    })
    return forward.localPort
  }

  async close(environmentId: string): Promise<void> {
    this.ownershipGenerations.set(
      environmentId,
      (this.ownershipGenerations.get(environmentId) ?? 0) + 1
    )
    const active = this.active.get(environmentId)
    if (!active) {
      return
    }
    this.active.delete(environmentId)
    await this.forwards.removeForwardAndWait(active.forwardId)
  }

  async closeTarget(targetId: string): Promise<void> {
    const environmentIds = new Set([...this.buildTargets.keys(), ...this.active.keys()])
    const carried = [...environmentIds].filter(
      (id) => this.buildTargets.get(id) === targetId || this.active.get(id)?.targetId === targetId
    )
    // Include unrecorded forwards still starting or checking identity.
    await Promise.all([
      ...carried.map((environmentId) => this.close(environmentId)),
      this.forwards.removeAllForwards(targetId)
    ])
  }

  async shutdown(): Promise<void> {
    this.managerGeneration += 1
    this.active.clear()
    await this.forwards.closeAll()
  }

  dispose(): void {
    this.managerGeneration += 1
    this.active.clear()
    this.inFlight.clear()
    this.ownershipGenerations.clear()
    this.buildTargets.clear()
    this.resumeRecovery.dispose()
    this.forwards.dispose()
  }

  async verifyServing(environment: KnownRuntimeEnvironment): Promise<MadangdManagedServing> {
    if (!this.active.has(environment.id)) {
      await this.ensure(environment)
    }
    const serving = await this.checkServing(environment)
    if (serving.rebind) {
      await this.ensure(environment)
    }
    // The new tunnel may reach a different port; its server needs a fresh serving check.
    return serving.rebind && serving.state !== 'started' ? this.checkServing(environment) : serving
  }

  /** Safe during builds: drop moved-port forwards without recursively rebuilding. */
  checkServing(environment: KnownRuntimeEnvironment): Promise<MadangdTunnelServing> {
    return checkManagedTunnelServing({
      environment,
      active: this.active,
      getTarget: (id) => this.dependencies.getTargetStore()?.getTarget(id),
      forwards: this.forwards,
      ensureServing: this.dependencies.ensureServing,
      readPublishedPort: this.targeting.readPublishedPort
    })
  }

  recoverAfterHostResume(options: MadangdManagedTunnelResumeOptions): Promise<void> {
    return this.resumeRecovery.recover(options)
  }

  private async ensureManagedTunnel(
    environment: KnownRuntimeEnvironment,
    resolveCurrent: () => KnownRuntimeEnvironment | null,
    rebound = false
  ): Promise<void> {
    const { deployment, targetStore, connectionManager, target } = resolveManagedTunnelBinding(
      environment,
      this.dependencies
    )
    this.buildTargets.set(environment.id, target.id)
    const managerGeneration = this.managerGeneration
    const ownershipGeneration = this.ownershipGenerations.get(environment.id) ?? 0
    const expected = { environmentId: environment.id, ...deployment }
    const stillOwned = (): boolean =>
      this.managerGeneration === managerGeneration &&
      (this.ownershipGenerations.get(environment.id) ?? 0) === ownershipGeneration &&
      managedTunnelStillPaired(
        environment,
        resolveCurrent(),
        targetStore.getTarget(target.id),
        expected
      )
    const connection = await connectionManager.connect(target)
    if (!stillOwned()) {
      throw supersededTunnelError()
    }
    const transportGeneration = connection.getConnectGeneration()
    const active = this.active.get(environment.id)
    if (activeTunnelMatches(active, { connection, transportGeneration, target, deployment })) {
      return
    }
    const checks = await environmentForwardChecks(this.targeting, {
      environment,
      target,
      connection
    })
    if (active && stillOwned()) {
      await dropActiveMadangdTunnel(this.active, this.forwards, environment.id, active)
    }
    if (!stillOwned()) {
      throw supersededTunnelError()
    }
    const forward = await forwardToVerifiedMadangd({
      targetId: target.id,
      connection,
      forwards: this.forwards,
      localPort: deployment.localPort,
      label: `Madang on ${environment.name}`,
      ...checks,
      stillCurrent: () => stillOwned() && connection.getConnectGeneration() === transportGeneration
    })
    if (!forward) {
      throw supersededTunnelError()
    }
    recordActiveMadangdTunnel(this.active, environment.id, forward, {
      connection,
      preferredPort: deployment.remotePort,
      sshTargetGeneration: deployment.sshTargetGeneration,
      targetId: target.id,
      transportGeneration
    })
    const recorded = this.active.get(environment.id)
    const serving = await this.checkServing(environment)
    if (!stillOwned() || connection.getConnectGeneration() !== transportGeneration) {
      if (recorded) {
        await dropActiveMadangdTunnel(this.active, this.forwards, environment.id, recorded)
      }
      throw supersededTunnelError()
    }
    if (serving.rebind && !rebound) {
      await this.ensureManagedTunnel(environment, resolveCurrent, true)
    }
  }
}
