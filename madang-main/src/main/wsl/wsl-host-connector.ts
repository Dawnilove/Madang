import { createWslMadangdPairingRecovery } from './wsl-madangd-pairing-repair'
import { readConfirmedRunningWslDistros } from '../wsl-background-distro-gate'
import { parsePairingCode } from '../../shared/pairing'
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { verifyMadangdPairingIdentity } from '../managed-server/lifecycle/madangd-managed-tunnel-identity'
import { resolveEnvironmentPairingOffer } from '../../shared/runtime-environment-store'
import { findWslHostDeployment } from '../../shared/runtime-environment-wsl-host-store'
import { createWslDistroHolder, type WslDistroHolder } from './wsl-distro-holder'
import { listWslHostDistros } from './wsl-host-distro-list'
import type { WslHostConnector } from './wsl-host-service'
import { readWslDistroMadangdPublicKey } from './wsl-host-ssh-madangd-conflict'
import {
  WslMadangdConnectionManager,
  type WslMadangdConnection,
  type WslMadangdConnectionDependencies
} from './wsl-madangd-connection'
import { defaultWslMadangdEnvironmentId, deployAndLaunchWslMadangd } from './wsl-madangd-deploy'
import { createWslMadangdHostTransport } from './wsl-madangd-host-transport'
import type { WslMadangdHostTarget } from './wsl-madangd-host-target'
import {
  decommissionWslHostMadangd,
  stopWslHostServer,
  wslHostRuntimeStopSteps,
  type WslHostRuntimeAccess
} from './wsl-host-server-stop'
import { createWslMadangdLivenessSupervisor } from './wsl-madangd-liveness-wiring'
import type { WslMadangdLivenessSupervisor } from './wsl-madangd-liveness-supervisor'
import { confirmsRunning } from './wsl-madangd-liveness-evidence'
import { wslDistroHolderKey } from './wsl-distro-holder-record'

function targetFor(distro: string): WslMadangdHostTarget {
  return { kind: 'wsl', id: defaultWslMadangdEnvironmentId(distro), distro, label: distro }
}

function transportFor(distro: string) {
  return createWslMadangdHostTransport({ target: targetFor(distro) })
}

type Reachability = 'available' | 'unreachable' | 'stopped' | 'unavailable'

export function createWslHostConnector(options: {
  userDataPath: string
  onChange: NonNullable<WslMadangdConnectionDependencies['onChange']>
  hasUserVisibleWork: (distro: string) => boolean
  /** False once a distro's host is gone: nothing may be spawned for it again. */
  isKnownDistro: (distro: string) => boolean
  runtime: WslHostRuntimeAccess
}): WslHostConnector {
  const refuseUnknown = (distro: string): Error =>
    new Error(`${distro} is no longer a WSL host; Madang will not start anything for it.`)
  // Assigned below; a holder exit cannot arrive before the first ensure.
  let supervisor: WslMadangdLivenessSupervisor | null = null
  const unguardedHolder = createWslDistroHolder({
    userDataPath: options.userDataPath,
    onHolderExit: (distro, exit) => supervisor?.noteHolderExit(distro, exit)
  })
  // Guard here because liveness recovery and deploy can bypass the service.
  const holder: WslDistroHolder = {
    ...unguardedHolder,
    ensureHeld: (distro) =>
      options.isKnownDistro(distro)
        ? unguardedHolder.ensureHeld(distro)
        : Promise.reject(refuseUnknown(distro))
  }
  const pairingRecovery = createWslMadangdPairingRecovery(options.userDataPath)
  const manager = new WslMadangdConnectionManager({
    holder,
    pairingRecovery,
    getPairingOffer: (environmentId) =>
      findWslHostDeployment(options.userDataPath, environmentId)
        ? resolveEnvironmentPairingOffer(options.userDataPath, environmentId)
        : null,
    onChange: options.onChange,
    deployAndLaunch: (distro, deployOptions) =>
      options.isKnownDistro(distro)
        ? deployAndLaunchWslMadangd(distro, deployOptions)
        : Promise.reject(refuseUnknown(distro))
  })
  const liveness = createWslMadangdLivenessSupervisor({
    manager,
    holder,
    hasUserVisibleWork: options.hasUserVisibleWork
  })
  supervisor = liveness
  const coldProbes = new Map<
    string,
    {
      connection: WslMadangdConnection | null
      pairingOffer: string | undefined
      result: Promise<Reachability>
    }
  >()
  const probe = async (
    distro: string,
    environmentId: string,
    connection: WslMadangdConnection | null
  ): Promise<Reachability> => {
    // Bridge dialing spawns wsl.exe; passive checks must first prove the distro runs.
    const running = await readConfirmedRunningWslDistros()
    if (running.status === 'unavailable') {
      return 'unavailable'
    }
    if (!confirmsRunning(running, wslDistroHolderKey(distro))) {
      return 'stopped'
    }
    if (!options.isKnownDistro(distro) || manager.get(distro) !== connection) {
      return 'unreachable'
    }
    if (options.runtime.isReady?.(environmentId)) {
      return 'available'
    }
    if (!connection) {
      return 'unreachable'
    }
    const offer = parsePairingCode(connection.pairingOffer)
    if (!offer) {
      return 'unreachable'
    }
    const identity = await verifyMadangdPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
      runtimeId: null
    })
    return identity.verdict === 'verified' && manager.get(distro) === connection
      ? 'available'
      : 'unreachable'
  }
  const coldReachability = (distro: string, environmentId: string): Promise<Reachability> => {
    const key = `${wslDistroHolderKey(distro)}\0${environmentId}`
    const connection = manager.get(distro)
    const pairingOffer = connection?.pairingOffer
    const pending = coldProbes.get(key)
    if (pending && pending.connection === connection && pending.pairingOffer === pairingOffer) {
      return pending.result
    }
    const result = probe(distro, environmentId, connection).finally(() => {
      if (coldProbes.get(key)?.result === result) {
        coldProbes.delete(key)
      }
    })
    coldProbes.set(key, { connection, pairingOffer, result })
    return result
  }
  return {
    listDistros: () => listWslHostDistros(),
    readMadangdPublicKey: (distro) => readWslDistroMadangdPublicKey(transportFor(distro)),
    connect: (distro, connectOptions) => liveness.connect(distro, connectOptions),
    forgetPairingFailures: (environmentId) => pairingRecovery.repairs.forgetFailures(environmentId),
    get: (distro) => manager.get(distro),
    isReachable: async (distro, environmentId) =>
      options.runtime.isReady?.(environmentId) ||
      (await coldReachability(distro, environmentId)) === 'available',
    disconnect: (distro) => liveness.stop(distro),
    stopServer: async (distro, environmentId) => {
      const reachability = await coldReachability(distro, environmentId)
      if (reachability === 'unavailable') {
        return {
          stopped: false,
          reason: 'The WSL service did not confirm whether the distro runs.'
        }
      }
      if (reachability === 'stopped') {
        return { stopped: true }
      }
      if (reachability === 'unreachable') {
        await liveness.connect(distro)
      }
      const target = targetFor(distro)
      return stopWslHostServer({
        ...wslHostRuntimeStopSteps(options.runtime, environmentId),
        closeBridge: () => liveness.stop(distro),
        decommission: decommissionWslHostMadangd(target, createWslMadangdHostTransport({ target }))
      })
    },
    releaseHolder: async (distro) => {
      await holder.release(distro)
    },
    adoptHolders: async () => {
      await holder.adoptHolders()
    },
    dispose: () => liveness.dispose()
  }
}
