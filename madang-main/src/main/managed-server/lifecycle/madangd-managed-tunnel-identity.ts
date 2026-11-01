// Open forwards prove no identity; require an authenticated status call from the pinned server.
import { parsePairingCode } from '../../../shared/pairing'
import {
  pairedRuntimeConnectionFromOffer,
  type PairedRuntimeConnection
} from '../../../shared/paired-runtime-connection'
import { MADANGD_MANAGED_REMOTE_PORT } from '../../../shared/madangd-managed-runtime'
import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../shared/remote-runtime/remote-runtime-client-error-classification'
import { RemoteRuntimeClientError } from '../../../shared/remote-runtime-client-error'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { verifyRuntimePairingIdentity } from '../../runtime/runtime-environment-identity-verification'
import type { ServeReadiness } from '../../server/serve-readiness'
import { madangdBoundPort } from './madangd-managed-bound-port'
import { tunneledMadangdPairingCode } from '../../ssh/madangd-tunneled-pairing'

/** Unreachable proves no identity; unpaired is a refusal sealed by the pinned server key. */
export type MadangdTunnelIdentity =
  | { verdict: 'verified' }
  | { verdict: 'foreign' | 'unreachable' | 'unpaired'; detail: string }

export const MADANGD_IDENTITY_MISMATCH_CODE = 'madangd_identity_mismatch'

export class MadangdManagedIdentityError extends Error {
  readonly code = MADANGD_IDENTITY_MISMATCH_CODE
  constructor(remotePort: number, detail: string) {
    super(
      `${MADANGD_IDENTITY_MISMATCH_CODE}: the server on remote port ${remotePort} is not this ` +
        `host’s Madang server (another Madang may be using that port): ${detail}`
    )
    this.name = 'MadangdManagedIdentityError'
  }
}

export const MADANGD_PAIRING_REJECTED_CODE = 'madangd_pairing_rejected'

export class MadangdManagedPairingRejectedError extends Error {
  readonly code = MADANGD_PAIRING_REJECTED_CODE
  constructor(detail: string) {
    super(
      `${MADANGD_PAIRING_REJECTED_CODE}: this host’s Madang server no longer accepts ` +
        `this desktop's pairing (its saved devices were reset, or this desktop was removed ` +
        `there), so reconnecting alone won't restore access: ${detail}`
    )
    this.name = 'MadangdManagedPairingRejectedError'
  }
}

export function madangdIdentityRefusal(
  remotePort: number,
  identity: Exclude<MadangdTunnelIdentity, { verdict: 'verified' }>
): Error {
  return identity.verdict === 'unpaired'
    ? new MadangdManagedPairingRejectedError(identity.detail)
    : new MadangdManagedIdentityError(remotePort, identity.detail)
}

// Key rejection closes the socket instead of returning a status reply.
const FOREIGN_CLOSE_CODES = new Set([4001, 4003])

export function classifyMadangdTunnelIdentityFailure(error: unknown): MadangdTunnelIdentity {
  const detail = error instanceof Error ? error.message : String(error)
  // Only sealed access-grant refusals prove the pinned server answered.
  if (
    error instanceof RemoteRuntimeClientError &&
    error.code === 'unauthorized' &&
    error.pairingStage === 'access-grant'
  ) {
    return { verdict: 'unpaired', detail }
  }
  if (error instanceof RemoteRuntimeClientError && FOREIGN_CLOSE_CODES.has(error.closeCode ?? 0)) {
    return { verdict: 'foreign', detail }
  }
  return isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))
    ? { verdict: 'unreachable', detail }
    : { verdict: 'foreign', detail }
}

export async function verifyMadangdPairingIdentity(
  connection: PairedRuntimeConnection,
  expected: Pick<KnownRuntimeEnvironment, 'runtimeId' | 'pairedDeviceId'>
): Promise<MadangdTunnelIdentity> {
  try {
    await verifyRuntimePairingIdentity(connection, expected)
    return { verdict: 'verified' }
  } catch (error) {
    return classifyMadangdTunnelIdentityFailure(error)
  }
}

export function verifyManagedMadangdTunnelIdentity(
  environment: KnownRuntimeEnvironment
): Promise<MadangdTunnelIdentity> {
  if (!environment.madangdDeployment) {
    return Promise.resolve({ verdict: 'verified' })
  }
  // Runtime/device IDs can change or become stale; pinned-key handshake and token acceptance prove identity.
  return verifyMadangdPairingIdentity(getPreferredPairedRuntimeConnection(environment), {
    runtimeId: null
  })
}

/** Fresh deploys have no saved pairing; reread readiness after foreign answers to follow port changes. */
export function deployedMadangdTunnelChecks(
  initial: ServeReadiness,
  rereadReadiness: () => Promise<ServeReadiness>
) {
  let readiness = initial
  return {
    readiness: () => readiness,
    remotePort: madangdBoundPort(initial) ?? MADANGD_MANAGED_REMOTE_PORT,
    rereadRemotePort: async () => {
      readiness = await rereadReadiness()
      return madangdBoundPort(readiness) ?? MADANGD_MANAGED_REMOTE_PORT
    },
    verify: async (localPort: number): Promise<MadangdTunnelIdentity> => {
      const pairing = parsePairingCode(tunneledMadangdPairingCode(readiness, localPort))
      return pairing
        ? verifyMadangdPairingIdentity(pairedRuntimeConnectionFromOffer(pairing), {
            runtimeId: readiness.runtimeId || null
          })
        : { verdict: 'foreign', detail: 'This host’s Madang server published an invalid pairing.' }
    }
  }
}
