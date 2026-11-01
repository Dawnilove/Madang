/** Unknown failures, including older hosts without census support, stay unverifiable and never mean zero live terminals. */
import { MADANGD_TERMINAL_CENSUS_RUNTIME_CAPABILITY } from '../../shared/madangd-runtime-capabilities'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/electron-remote-runtime-client-capabilities'
import type { PairedRuntimeConnection } from '../../shared/paired-runtime-connection'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import {
  MADANGD_TERMINAL_CENSUS_METHOD,
  MadangdTerminalCensusSchema,
  type MadangdTerminalCensus,
  UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
} from '../../shared/madangd-terminal-census'
import { sendRemoteRuntimeRequestWithStatusPreflight } from '../../shared/remote-runtime-client'
import type { MadangdActivationRecord } from '../managed-server/activation/madangd-activation-record'
import { ensureMadangdManagedTunnel } from '../managed-server/lifecycle/madangd-managed-tunnel'
import { verifyMadangdManagedServing } from '../managed-server/lifecycle/madangd-managed-serving-verify'

export type MadangdTerminalCensusRequestOptions = {
  releaseFinishedAutomationTerminals?: boolean
  /** Close the server's terminal admission this long before counting; 0 reopens it. */
  closeAdmissionForMs?: number
}

/** Wake idle servers behind ensured tunnels; failed wake/tunnel stays unverifiable. */
export async function collectManagedTerminalCensus(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  record: MadangdActivationRecord,
  timeoutMs = 15_000,
  options: MadangdTerminalCensusRequestOptions = {}
): Promise<MadangdTerminalCensus> {
  if (!record.active) {
    return { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  }
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
  }
  try {
    // Use the tunnel's returned pairing; re-pairing may have retired the caller's token.
    const current = await ensureMadangdManagedTunnel(userDataPath, environment.id)
    // Wake before census, except for reopen: a stopped server has no admission to release.
    if (options.closeAdmissionForMs !== 0) {
      await verifyMadangdManagedServing(userDataPath, environment.id)
    }
    return await requestMadangdTerminalCensus(
      getPreferredPairedRuntimeConnection(current),
      activatedAt,
      timeoutMs,
      options
    )
  } catch {
    return UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
  }
}

export async function requestMadangdTerminalCensus(
  connection: PairedRuntimeConnection,
  activatedAt: number,
  timeoutMs = 15_000,
  options: MadangdTerminalCensusRequestOptions = {}
): Promise<MadangdTerminalCensus> {
  try {
    const response = await sendRemoteRuntimeRequestWithStatusPreflight<unknown>(
      connection,
      MADANGD_TERMINAL_CENSUS_METHOD,
      {
        activatedAt,
        ...(options.releaseFinishedAutomationTerminals
          ? { releaseFinishedAutomationTerminals: true }
          : {}),
        // Older servers safely omit both unsupported admission request and reply fields.
        ...(options.closeAdmissionForMs === undefined
          ? {}
          : { closeAdmissionForMs: options.closeAdmissionForMs })
      },
      timeoutMs,
      (status) => {
        if (
          !status.ok ||
          !status.result.capabilities?.includes(MADANGD_TERMINAL_CENSUS_RUNTIME_CAPABILITY)
        ) {
          throw new Error('This host’s Madang server does not report a terminal census.')
        }
      },
      undefined,
      ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
    )
    return response.ok
      ? MadangdTerminalCensusSchema.parse(response.result)
      : UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
  } catch {
    return UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
  }
}
