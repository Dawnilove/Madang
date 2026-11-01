/** One in-memory connection per distro: C4 launch, C5 stdio bridge and loopback-rewritten pairing. Rebind when madangd moves ports; C7 persists onChange results. */
import type { WslMadangdConnection } from './wsl-madangd-connection-types'
import {
  WslMadangdConnectionSupersededError,
  WslMadangdLaunchDeferredError
} from './wsl-madangd-connection-errors'
import type { WslHostConnectIntent } from '../../shared/wsl-host-types'
import { errorMessage } from '../../shared/error-message'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import type { ServeReadiness } from '../server/serve-readiness'
import type { MadangdHostTransport } from '../ssh/madangd-host-transport'
import type { MadangdTunnelIdentity } from '../managed-server/lifecycle/madangd-managed-tunnel-identity'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'
import type { WslDistroHolder } from './wsl-distro-holder'
import {
  wslConnectFailedStatus,
  type WslMadangdConnectionStatus
} from './wsl-madangd-connection-status'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import {
  defaultWslMadangdEnvironmentId,
  deployAndLaunchWslMadangd,
  type WslMadangdDeployOptions,
  type WslMadangdLaunch
} from './wsl-madangd-deploy'
import type { WslMadangdHostTarget } from './wsl-madangd-host-target'
import { createWslMadangdHostTransport } from './wsl-madangd-host-transport'
import { resolveWslMadangdPairing, type WslMadangdPairingRecovery } from './wsl-madangd-pairing-identity'
import { trackWslMadangdHostEnvironment } from './wsl-madangd-host-environments'
import {
  listenWslMadangdStdioBridgeOnPreferredPort,
  type WslMadangdStdioBridgeOptions
} from './wsl-madangd-stdio-bridge'

export type { WslMadangdConnection } from './wsl-madangd-connection-types'

export type WslMadangdConnectOptions = {
  environmentId?: string
  label?: string
  /** Rebinds a port a persisted pairing offer already names; 0 or absent picks a free one. */
  localPort?: number
  intent?: WslHostConnectIntent
  signal?: AbortSignal
  /** What `onChange` reports while this connect runs and once it is ready (liveness recovery). */
  status?: WslMadangdConnectStatus
}

type WslMadangdConnectStatus = { pending: WslMadangdConnectionStatus; ready: WslMadangdConnectionStatus }

const CONNECTING: WslMadangdConnectionStatus = { state: 'connecting' }
const READY: WslMadangdConnectionStatus = { state: 'ready', census: null }

export type WslMadangdConnectionDependencies = {
  holder?: WslDistroHolder
  getPairingOffer?: (environmentId: string) => PairingOffer | null
  deployAndLaunch?: (distro: string, options: WslMadangdDeployOptions) => Promise<WslMadangdLaunch>
  createTransport?: (target: WslMadangdHostTarget) => MadangdHostTransport
  listen?: (
    transport: MadangdHostTransport,
    options: WslMadangdStdioBridgeOptions
  ) => Promise<StartedPortForward>
  verifyIdentity?: (pairingOffer: string, readiness: ServeReadiness) => Promise<MadangdTunnelIdentity>
  /** Re-pairs a refused enrolled token; without it a refusal fails the connect. */
  pairingRecovery?: Omit<WslMadangdPairingRecovery, 'environmentId'>
  /** A connection (re)opened, its offer changed, or its status moved; null once it closed. */
  onChange?: (
    distro: string,
    connection: WslMadangdConnection | null,
    status: WslMadangdConnectionStatus
  ) => void
}

type ActiveWslMadangdConnection = {
  connection: WslMadangdConnection
  forward: StartedPortForward
}

export class WslMadangdConnectionManager {
  private readonly active = new Map<string, ActiveWslMadangdConnection>()
  private readonly inFlight = new Map<string, Promise<WslMadangdConnection>>()
  private readonly generations = new Map<string, number>()

  constructor(private readonly dependencies: WslMadangdConnectionDependencies = {}) {}

  /** Joins a connect already running for this distro rather than racing a second bridge. */
  ensure(distro: string, options: WslMadangdConnectOptions = {}): Promise<WslMadangdConnection> {
    const name = distro.trim()
    if (!name) {
      return Promise.reject(new Error('A WSL distro name is required'))
    }
    const key = wslDistroHolderKey(name)
    const pending = this.inFlight.get(key)
    if (pending) {
      if (!options.intent) {
        return pending
      }
      // Update/Force needs a separate deploy; joining plain connect would discard intent.
      const generation = this.generation(key)
      return pending
        .catch(() => {})
        .then(() => {
          if (this.generation(key) !== generation) {
            throw new WslMadangdConnectionSupersededError(name)
          }
          return this.ensure(distro, options)
        })
    }
    const status = options.status ?? { pending: CONNECTING, ready: READY }
    // Unchanged live refresh stays quiet; liveness recovery must publish.
    if (options.status || !this.active.has(key)) {
      this.dependencies.onChange?.(name, this.get(name), status.pending)
    }
    const operation = this.connect(name, key, options, status).catch((error: unknown) => {
      // Liveness owns reconnect status; superseded connects are already closed.
      if (!options.status && !(error instanceof WslMadangdConnectionSupersededError)) {
        const deferral = error instanceof WslMadangdLaunchDeferredError ? error.launch : null
        const failed = wslConnectFailedStatus(errorMessage(error), deferral)
        this.dependencies.onChange?.(name, this.get(name), failed)
      }
      throw error
    })
    const tracked: Promise<WslMadangdConnection> = operation.finally(() => {
      if (this.inFlight.get(key) === tracked) {
        this.inFlight.delete(key)
      }
    })
    this.inFlight.set(key, tracked)
    return tracked
  }

  /** Prefer persisted enrollment; only unrecorded hosts fall back to their live connection offer. */
  private enrolledOffer(key: string, environmentId: string): PairingOffer | null {
    const current = this.active.get(key)?.connection
    return (
      this.dependencies.getPairingOffer?.(environmentId) ??
      (current?.environmentId === environmentId ? parsePairingCode(current.pairingOffer) : null)
    )
  }

  get(distro: string): WslMadangdConnection | null {
    return this.active.get(wslDistroHolderKey(distro))?.connection ?? null
  }

  /** Liveness reports a status change for a distro, with whatever connection it has now. */
  publish(distro: string, status: WslMadangdConnectionStatus): void {
    this.dependencies.onChange?.(distro, this.get(distro), status)
  }

  list(): WslMadangdConnection[] {
    return [...this.active.values()].map((entry) => entry.connection)
  }

  async close(distro: string): Promise<void> {
    const key = wslDistroHolderKey(distro)
    this.generations.set(key, this.generation(key) + 1)
    const entry = this.active.get(key)
    if (!entry) {
      return
    }
    await this.drop(key, entry)
    this.dependencies.onChange?.(entry.connection.distro, null, { state: 'closed' })
  }

  /** Retires one bridge; unlike close, a connect queued behind it still runs. */
  private async drop(key: string, entry: ActiveWslMadangdConnection): Promise<void> {
    if (this.active.get(key) === entry) {
      this.active.delete(key)
    }
    await entry.forward.close()
    trackWslMadangdHostEnvironment(entry.connection, null)
  }

  async dispose(): Promise<void> {
    const keys = new Set([...this.active.keys(), ...this.inFlight.keys()])
    await Promise.all([...keys].map((key) => this.close(key)))
  }

  private generation(key: string): number {
    return this.generations.get(key) ?? 0
  }

  private async connect(
    distro: string,
    key: string,
    options: WslMadangdConnectOptions,
    status: WslMadangdConnectStatus
  ): Promise<WslMadangdConnection> {
    const generation = this.generation(key)
    const environmentId = options.environmentId ?? defaultWslMadangdEnvironmentId(distro)
    const label = options.label ?? distro
    const transport = (this.dependencies.createTransport ?? defaultTransport)({
      kind: 'wsl',
      id: environmentId,
      distro,
      label
    })
    // Relaunch stopped madangd on each connect so distro restarts recover.
    const launch = await (this.dependencies.deployAndLaunch ?? deployAndLaunchWslMadangd)(distro, {
      environmentId,
      label,
      intent: options.intent,
      pairedOffer: this.enrolledOffer(key, environmentId),
      signal: options.signal,
      holder: this.dependencies.holder,
      createTransport: () => transport
    })
    if (launch.outcome === 'deferred') {
      throw new WslMadangdLaunchDeferredError(launch)
    }
    if (this.generation(key) !== generation) {
      throw new WslMadangdConnectionSupersededError(distro)
    }
    const current = this.active.get(key)
    const persisted = this.dependencies.getPairingOffer?.(environmentId) ?? null
    const paired = persisted ?? this.enrolledOffer(key, environmentId)
    // Repair only persisted enrollment; an in-progress Add has no stored record to repair.
    const recovery =
      persisted && this.dependencies.pairingRecovery
        ? { ...this.dependencies.pairingRecovery, environmentId }
        : undefined
    if (
      current &&
      current.connection.remotePort === launch.port &&
      current.connection.environmentId === environmentId
    ) {
      const pairingOffer = await resolveWslMadangdPairing(
        launch,
        current.connection.localPort,
        paired,
        this.dependencies.verifyIdentity,
        recovery
      ).catch(async (error: unknown) => {
        // Retire the rejected bridge or publishing its stale token would overwrite pairing repaired by the gate.
        await this.drop(key, current)
        throw error
      })
      if (this.generation(key) !== generation) {
        throw new WslMadangdConnectionSupersededError(distro)
      }
      return this.refreshOffer(
        key,
        current,
        launch,
        pairingOffer,
        options.status ? status.ready : null
      )
    }
    // Port changes invalidate the old bridge; reuse its local port when possible.
    const preferredLocalPort = current?.connection.localPort ?? options.localPort ?? 0
    if (current) {
      await this.drop(key, current)
      this.dependencies.onChange?.(distro, null, status.pending)
    }
    const forward = await listenWslMadangdStdioBridgeOnPreferredPort(
      transport,
      {
        environmentId,
        remotePort: launch.port,
        localPort: preferredLocalPort,
        label: `Madang server in WSL: ${label}`
      },
      this.dependencies.listen
    )
    try {
      if (this.generation(key) !== generation) {
        throw new WslMadangdConnectionSupersededError(distro)
      }
      const pairingOffer = await resolveWslMadangdPairing(
        launch,
        forward.entry.localPort,
        paired,
        this.dependencies.verifyIdentity,
        recovery
      )
      if (this.generation(key) !== generation) {
        throw new WslMadangdConnectionSupersededError(distro)
      }
      const entry: ActiveWslMadangdConnection = {
        forward,
        connection: {
          distro,
          environmentId,
          localPort: forward.entry.localPort,
          remotePort: launch.port,
          fullVersion: launch.fullVersion,
          pid: launch.pid,
          pairingOffer,
          deferredUpdate: launch.deferredUpdate ?? null,
          close: () => this.closeEntry(key, entry)
        }
      }
      this.active.set(key, entry)
      trackWslMadangdHostEnvironment(entry.connection, entry.connection)
      this.dependencies.onChange?.(distro, entry.connection, status.ready)
      return entry.connection
    } catch (error) {
      await forward.close()
      throw error
    }
  }

  private refreshOffer(
    key: string,
    entry: ActiveWslMadangdConnection,
    launch: Extract<WslMadangdLaunch, { outcome: 'ready' }>,
    pairingOffer: string,
    /** Reported even when nothing changed; null stays quiet then. */
    announce: WslMadangdConnectionStatus | null
  ): WslMadangdConnection {
    const deferredUpdate = launch.deferredUpdate ?? null
    const changed =
      pairingOffer !== entry.connection.pairingOffer ||
      launch.fullVersion !== entry.connection.fullVersion ||
      launch.pid !== entry.connection.pid ||
      JSON.stringify(deferredUpdate) !== JSON.stringify(entry.connection.deferredUpdate)
    if (changed) {
      const { fullVersion, pid } = launch
      entry.connection = { ...entry.connection, pairingOffer, fullVersion, pid, deferredUpdate }
      this.active.set(key, entry)
    }
    trackWslMadangdHostEnvironment(entry.connection, entry.connection)
    if (changed || announce) {
      this.dependencies.onChange?.(entry.connection.distro, entry.connection, announce ?? READY)
    }
    return entry.connection
  }

  private async closeEntry(key: string, entry: ActiveWslMadangdConnection): Promise<void> {
    if (this.active.get(key) === entry) {
      await this.close(key)
    }
  }
}

function defaultTransport(target: WslMadangdHostTarget): MadangdHostTransport {
  return createWslMadangdHostTransport({ target })
}
