/** Use the managed SSH repair gate for refused WSL enrollment: serialize, cap attempts and require the pinned host key. Read new offers inside the local distro. */
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import {
  findWslHostDeployment,
  refreshWslHostPairing
} from '../../shared/runtime-environment-wsl-host-store'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import { readActiveManagedMadangdReadiness } from '../managed-server/lifecycle/madangd-managed-bound-port'
import {
  ManagedMadangdPairingRepairs,
  type ManagedMadangdPairingRepairDeps
} from '../managed-server/lifecycle/madangd-managed-pairing-repair'
import type { WslMadangdHostTransport } from './wsl-madangd-host-transport'
import { MadangdManagedPairingRepairFailedError } from '../managed-server/lifecycle/madangd-managed-pairing-repair-failure'
import { notifyManagedMadangdPairingRepaired } from '../managed-server/lifecycle/madangd-managed-pairing-repaired-listener'
import type { WslMadangdHostTarget } from './wsl-madangd-host-target'
import { createWslMadangdHostTransport } from './wsl-madangd-host-transport'
import type { WslMadangdPairingRecovery } from './wsl-madangd-pairing-identity'

type WslMadangdHostAccess = { target: WslMadangdHostTarget; connection: WslMadangdHostTransport }

export function liveWslMadangdPairingRepairDeps(
  userDataPath: string
): ManagedMadangdPairingRepairDeps<WslMadangdHostAccess> {
  const record = (environmentId: string) => {
    const found = findWslHostDeployment(userDataPath, environmentId)
    if (!found) {
      throw new MadangdManagedPairingRepairFailedError('this server is not a WSL host')
    }
    return found
  }
  return {
    resolve: (environmentId) => resolveEnvironment(userDataPath, environmentId),
    connect: async (environment: KnownRuntimeEnvironment) => {
      const target: WslMadangdHostTarget = {
        kind: 'wsl',
        id: environment.id,
        distro: record(environment.id).distro,
        label: environment.name
      }
      return { target, connection: createWslMadangdHostTransport({ target }) }
    },
    readReadiness: async (access) => {
      try {
        return await readActiveManagedMadangdReadiness(access)
      } finally {
        access.connection.dispose()
      }
    },
    ports: (environment) => {
      const found = findWslHostDeployment(userDataPath, environment.id)
      return found ? { localPort: found.localPort, remotePort: found.remotePort } : null
    },
    refresh: (environmentId, pairingCode) => {
      const { localPort, remotePort } = record(environmentId)
      return refreshWslHostPairing(userDataPath, environmentId, {
        pairingCode,
        localPort,
        remotePort
      }).environment
    },
    repaired: notifyManagedMadangdPairingRepaired,
    now: Date.now
  }
}

/** One gate per desktop, so the cap and a standing failure hold across every WSL connect. */
export function createWslMadangdPairingRecovery(
  userDataPath: string,
  deps: ManagedMadangdPairingRepairDeps<WslMadangdHostAccess> = liveWslMadangdPairingRepairDeps(
    userDataPath
  )
): Omit<WslMadangdPairingRecovery, 'environmentId'> {
  return { repairs: new ManagedMadangdPairingRepairs(deps), resolve: deps.resolve }
}
