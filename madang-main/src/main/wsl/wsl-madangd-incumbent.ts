/** E1: open a temporary bridge for incumbent census before activation. Unproven state is unverifiable, never zero; WSL has no standing deploy tunnel. */
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import { MADANGD_MANAGED_REMOTE_PORT } from '../../shared/madangd-managed-runtime'
import {
  type MadangdTerminalCensus,
  UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
} from '../../shared/madangd-terminal-census'
import type { ServeReadiness } from '../server/serve-readiness'
import { probeActiveMadangdReadiness } from '../ssh/madangd-active-readiness'
import { madangdBoundPort } from '../managed-server/lifecycle/madangd-managed-bound-port'
import { managedMadangdInstallDir } from '../managed-server/lifecycle/madangd-managed-runtime-context'
import { wakeStoppedManagedMadangd } from '../managed-server/lifecycle/madangd-managed-wake'
import type { MadangdRemoteContext } from '../managed-server/install/madangd-remote-context'
import type { MadangdSlotOptions } from '../ssh/madangd-recovery-slot'
import { readRemoteMadangdBuildHash } from '../managed-server/install/madangd-remote-build-hash'
import {
  requestMadangdTerminalCensus,
  type MadangdTerminalCensusRequestOptions
} from '../ssh/madangd-terminal-census-client'
import { updateTerminalCounts } from '../ssh/madangd-fenced-stop'
import { tunneledMadangdPairingCode } from '../ssh/madangd-tunneled-pairing'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'
import type { MadangdHostTransport } from '../ssh/madangd-host-transport'
import type { WslMadangdHostTarget } from './wsl-madangd-host-target'
import { listenWslMadangdStdioBridge } from './wsl-madangd-stdio-bridge'

export type WslMadangdIncumbent = {
  census: MadangdTerminalCensus
  /** The incumbent's proven readiness; null when it could not be started or proven. */
  readiness: ServeReadiness | null
  /** Recount without wake and close terminal admission before activation stops the incumbent; unreadable never means zero. */
  recount: () => Promise<MadangdTerminalCensus>
  /** Reopens the admission `recount` closed, when the incumbent keeps running. */
  releaseAdmission: () => Promise<void>
}

type IncumbentArgs = {
  context: MadangdRemoteContext<WslMadangdHostTarget>
  slot: MadangdSlotOptions
  /** This desktop's enrolled pairing; null before its first pairing. */
  paired?: PairingOffer | null
}

const UNREADABLE: WslMadangdIncumbent = {
  census: UNVERIFIABLE_MADANGD_TERMINAL_CENSUS,
  readiness: null,
  recount: async () => UNVERIFIABLE_MADANGD_TERMINAL_CENSUS,
  releaseAdmission: async () => {}
}

export type WslMadangdIncumbentDependencies = {
  wake: typeof wakeStoppedManagedMadangd
  probe: typeof probeActiveMadangdReadiness
  readBuildHash: typeof readRemoteMadangdBuildHash
  listen: (
    transport: MadangdHostTransport,
    remotePort: number,
    target: WslMadangdHostTarget
  ) => Promise<StartedPortForward>
  census: typeof requestMadangdTerminalCensus
}

const DEFAULT_DEPENDENCIES: WslMadangdIncumbentDependencies = {
  wake: wakeStoppedManagedMadangd,
  probe: probeActiveMadangdReadiness,
  readBuildHash: readRemoteMadangdBuildHash,
  listen: (transport, remotePort, target) =>
    listenWslMadangdStdioBridge(transport, {
      environmentId: target.id,
      remotePort,
      localPort: 0,
      label: `Madang server in WSL: ${target.label} (update check)`
    }),
  census: requestMadangdTerminalCensus
}

/** Wake reboot/idle-stopped incumbent, census its daemon, then close the temporary bridge before returning. */
export async function readWslMadangdIncumbent(
  args: IncumbentArgs,
  dependencies: WslMadangdIncumbentDependencies = DEFAULT_DEPENDENCIES
): Promise<WslMadangdIncumbent> {
  const record = args.context.activationRecord
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!record.active || !Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNREADABLE
  }
  let readiness: ServeReadiness
  try {
    const wake = await dependencies.wake(args.slot)
    if (wake.outcome === 'started') {
      readiness = wake.readiness
    } else if (wake.outcome === 'serving') {
      const remoteInstallDir = managedMadangdInstallDir(args.context, record.active)
      readiness = await dependencies.probe(
        { ...args.slot, remoteInstallDir },
        {
          buildHash: await dependencies.readBuildHash(args.slot, remoteInstallDir),
          fullVersion: record.active
        }
      )
    } else {
      return UNREADABLE
    }
  } catch {
    return UNREADABLE
  }
  const counts = updateTerminalCounts((options) =>
    countIncumbentTerminals(args, readiness, activatedAt, dependencies, options)
  )
  return {
    census: await counts.countFirst(),
    readiness,
    recount: counts.recountCensus,
    releaseAdmission: counts.releaseIncumbentAdmission
  }
}

async function countIncumbentTerminals(
  args: IncumbentArgs,
  readiness: ServeReadiness,
  activatedAt: number,
  dependencies: WslMadangdIncumbentDependencies,
  options: MadangdTerminalCensusRequestOptions
): Promise<MadangdTerminalCensus> {
  let forward: StartedPortForward | null = null
  try {
    forward = await dependencies.listen(
      args.slot.conn,
      madangdBoundPort(readiness) ?? MADANGD_MANAGED_REMOTE_PORT,
      args.context.target
    )
    // Use enrolled grants; startup offers would enroll a fresh device on every census.
    const offer = parsePairingCode(
      tunneledMadangdPairingCode(readiness, forward.entry.localPort, args.paired)
    )
    if (!offer) {
      return UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
    }
    return await dependencies.census(
      pairedRuntimeConnectionFromOffer(offer),
      activatedAt,
      undefined,
      options
    )
  } catch {
    return UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
  } finally {
    await forward?.close().catch(() => {})
  }
}
