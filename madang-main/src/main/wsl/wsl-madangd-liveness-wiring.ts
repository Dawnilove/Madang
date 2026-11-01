/** C7 supplies visible demand; these production probes serve the WSL liveness supervisor. */
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode } from '../../shared/pairing'
import {
  type MadangdTerminalCensus,
  UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
} from '../../shared/madangd-terminal-census'
import { requestMadangdTerminalCensus } from '../ssh/madangd-terminal-census-client'
import { subscribeSystemPowerLifecycle } from '../system-power-lifecycle'
import {
  deferUntilWslDistroRunning,
  readConfirmedRunningWslDistros
} from '../wsl-background-distro-gate'
import type { WslDistroHolder } from './wsl-distro-holder'
import { readWslGuestIdentity } from './wsl-guest-process-identity'
import type { WslMadangdConnection, WslMadangdConnectionManager } from './wsl-madangd-connection'
import { defaultWslMadangdEnvironmentId } from './wsl-madangd-deploy'
import { WslMadangdLivenessSupervisor } from './wsl-madangd-liveness-supervisor'
import { createWslMadangdHostTransport } from './wsl-madangd-host-transport'
import { openWslMadangdWatch } from './wsl-madangd-watch'

function transportFor(distro: string, environmentId = defaultWslMadangdEnvironmentId(distro)) {
  return createWslMadangdHostTransport({
    target: { kind: 'wsl', id: environmentId, distro, label: distro }
  })
}

/** Every session counts (activation time 0): liveness asks how many survived, not how new. */
function collectWslMadangdCensus(connection: WslMadangdConnection): Promise<MadangdTerminalCensus> {
  const offer = parsePairingCode(connection.pairingOffer)
  return offer
    ? requestMadangdTerminalCensus(pairedRuntimeConnectionFromOffer(offer), 0)
    : Promise.resolve(UNVERIFIABLE_MADANGD_TERMINAL_CENSUS)
}

export function createWslMadangdLivenessSupervisor(options: {
  manager: WslMadangdConnectionManager
  holder: WslDistroHolder
  hasUserVisibleWork: (distro: string) => boolean
}): WslMadangdLivenessSupervisor {
  return new WslMadangdLivenessSupervisor({
    manager: options.manager,
    readRunning: readConfirmedRunningWslDistros,
    readIdentity: (distro, madangdPid) => readWslGuestIdentity(transportFor(distro), madangdPid),
    openWatch: (connection) =>
      openWslMadangdWatch(
        transportFor(connection.distro, connection.environmentId),
        connection.remotePort
      ),
    collectCensus: collectWslMadangdCensus,
    hasUserVisibleWork: options.hasUserVisibleWork,
    deferUntilRunning: deferUntilWslDistroRunning,
    ensureHolder: (distro) => options.holder.ensureHeld(distro),
    subscribePower: subscribeSystemPowerLifecycle
  })
}
