import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import type { ServeReadiness } from '../server/serve-readiness'
import {
  madangdIdentityRefusal,
  verifyMadangdPairingIdentity,
  type MadangdTunnelIdentity
} from '../managed-server/lifecycle/madangd-managed-tunnel-identity'
import { tunneledMadangdPairingCode } from '../ssh/madangd-tunneled-pairing'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import {
  buildWithPairingRepair,
  type ManagedMadangdPairingRecovery
} from '../managed-server/lifecycle/madangd-managed-tunnel-pairing-recovery'
import type { WslMadangdLaunch } from './wsl-madangd-deploy'

/** The managed repair gate a refused enrolled token goes through, for one WSL host. */
export type WslMadangdPairingRecovery = Omit<ManagedMadangdPairingRecovery, 'ensure'> & {
  environmentId: string
}

/** Reconnect with enrolled token/pinned host key. Repair refusal once through the gate and verify the replacement; startup offers are for enrollment only. */
export async function resolveWslMadangdPairing(
  launch: Extract<WslMadangdLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity = verifyWslMadangdIdentity,
  recovery?: WslMadangdPairingRecovery
): Promise<string> {
  const verified = (offer: PairingOffer | null) =>
    verifyWslMadangdPairing(launch, localPort, offer, verifyIdentity)
  // First-time pairing has no enrolled token to repair.
  if (!recovery || !paired) {
    return verified(paired)
  }
  let pairingOffer = ''
  await buildWithPairingRepair(
    {
      ...recovery,
      ensure: async (environment) => {
        pairingOffer = await verified(getPreferredPairingOffer(environment))
      }
    },
    recovery.environmentId,
    async () => {
      pairingOffer = await verified(paired)
    }
  )
  return pairingOffer
}

async function verifyWslMadangdPairing(
  launch: Extract<WslMadangdLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity: typeof verifyWslMadangdIdentity
): Promise<string> {
  const pairingOffer = tunneledMadangdPairingCode(launch.readiness, localPort, paired)
  const identity = await verifyIdentity(pairingOffer, launch.readiness)
  if (identity.verdict === 'foreign' || identity.verdict === 'unpaired') {
    throw madangdIdentityRefusal(launch.port, identity)
  }
  if (identity.verdict === 'unreachable') {
    console.warn(
      `[wsl] Madang server in ${launch.distro} did not answer its bridge: ${identity.detail}`
    )
  }
  return pairingOffer
}

/** Whether the server behind a WSL bridge is the madangd that published `readiness`. */
export async function verifyWslMadangdIdentity(
  pairingOffer: string,
  readiness: ServeReadiness
): Promise<MadangdTunnelIdentity> {
  const offer = parsePairingCode(pairingOffer)
  return offer
    ? verifyMadangdPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
        runtimeId: readiness.runtimeId || null
      })
    : { verdict: 'foreign', detail: 'The Madang server in WSL published an invalid pairing offer.' }
}
