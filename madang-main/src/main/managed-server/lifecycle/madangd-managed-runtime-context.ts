import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import { MADANGD_UPDATE_TERMINALS_RUNNING_CODE } from '../../../shared/madangd-managed-runtime'
import {
  getMadangdSshDeployment,
  type KnownRuntimeEnvironment,
  type MadangdSshDeploymentLink
} from '../../../shared/runtime-environments'
import { getManagedMadangdFenceEnvironmentId } from '../../../shared/managed-madangd-ssh-owner'
import type { ServeReadiness } from '../../server/serve-readiness'
import { computeLocalMadangdBuildHash } from '../../ssh/madangd-local-build-hash'
import { sshMadangdHostTransport } from '../../ssh/madangd-ssh-host-transport'
import type { MadangdHostTarget } from '../../ssh/madangd-host-transport'
import type { MadangdActivationRecord } from '../activation/madangd-activation-record'
import { admitMadangdRecordForIntent, type MadangdUpdateIntent } from './madangd-managed-update-decision'
import {
  type MadangdTerminalCensus,
  UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
} from '../../../shared/madangd-terminal-census'
import { probeActiveMadangdReadiness } from '../../ssh/madangd-active-readiness'
import { resolveMadangdRemoteContext, type MadangdRemoteContext } from '../install/madangd-remote-context'
import { MADANGD_INSTALL_MODEL } from '../install/remote-install-model'
import { computeRemoteInstallDir } from '../install/remote-versioned-install'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'

const MADANGD_BIND_HOST = '127.0.0.1'

// Pinned slots must fail on absent markers rather than silently use host Node.
const MANAGED_MADANGD_LEGACY_NODE_PATH = ''

export function requireManagedMadangdInfrastructure() {
  const targetStore = requireManagedMadangdTargetStore()
  const connectionManager = getSshConnectionManager()
  if (!connectionManager) {
    throw new Error('SSH is unavailable on this client; this host’s Madang server is unverifiable.')
  }
  return { connectionManager, targetStore, claims: targetStore.getMadangdRuntimeClaims() }
}

export function requireManagedMadangdTargetStore() {
  const targetStore = getSshTargetRegistryStore()
  if (!targetStore) {
    throw new Error('SSH target state is unavailable; this host’s Madang server is unverifiable.')
  }
  return targetStore
}

export function requireManagedMadangdEnvironment(
  userDataPath: string,
  selector: string
): { environment: KnownRuntimeEnvironment; deployment: MadangdSshDeploymentLink } {
  const environment = resolveEnvironment(userDataPath, selector)
  const deployment = getMadangdSshDeployment(environment)
  if (!deployment || environment.connectionDependency !== 'ssh-tunnel') {
    throw new Error('This server is not managed through an madangd SSH deployment.')
  }
  return { environment, deployment }
}

export async function resolveLinkedMadangdContext(
  environment: KnownRuntimeEnvironment,
  deployment: MadangdSshDeploymentLink,
  signal?: AbortSignal
): Promise<MadangdRemoteContext> {
  const { connectionManager, targetStore } = requireManagedMadangdInfrastructure()
  const target = targetStore.getTarget(deployment.sshTargetId)
  if (
    !target ||
    target.generation !== deployment.sshTargetGeneration ||
    getManagedMadangdFenceEnvironmentId(target) !== environment.id
  ) {
    throw new Error('The SSH registration for this host’s Madang server is no longer valid.')
  }
  const connection = await connectionManager.connect(target)
  return resolveMadangdRemoteContext(target, sshMadangdHostTransport(connection), signal)
}

export function managedMadangdSlot(
  context: MadangdRemoteContext<MadangdHostTarget>,
  port: number,
  signal?: AbortSignal
) {
  return {
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    nodePath: MANAGED_MADANGD_LEGACY_NODE_PATH,
    userDataDir: context.userDataDir,
    bindHost: MADANGD_BIND_HOST,
    port,
    signal
  }
}

export function managedMadangdInstallDir(
  context: MadangdRemoteContext<MadangdHostTarget>,
  version: string
): string {
  return computeRemoteInstallDir(
    MADANGD_INSTALL_MODEL,
    context.remoteHome,
    version,
    context.host.pathFlavor
  )
}

/** Accept readiness only from the build this client holds. */
export function probeManagedMadangdReadiness(
  context: MadangdRemoteContext<MadangdHostTarget>,
  localMadangdDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<ServeReadiness> {
  return probeActiveMadangdReadiness(
    {
      conn: context.connection,
      host: context.host,
      remoteInstallDir: managedMadangdInstallDir(context, fullVersion),
      signal
    },
    { buildHash: computeLocalMadangdBuildHash(localMadangdDir), fullVersion }
  )
}

export function managedMadangdDeployPolicy(
  context: Pick<MadangdRemoteContext<MadangdHostTarget>, 'activationRecord'>,
  appVersion: string,
  intent: MadangdUpdateIntent
): {
  census: MadangdTerminalCensus
  recountCensus: () => Promise<MadangdTerminalCensus>
  releaseIncumbentAdmission: () => Promise<void>
  censusRecord: MadangdActivationRecord
  admitRecord: (record: MadangdActivationRecord, candidateVersion: string) => string | null
} {
  // Only the active daemon can count sessions; guessing zero risks restarting live terminals.
  const census: MadangdTerminalCensus = context.activationRecord.active
    ? UNVERIFIABLE_MADANGD_TERMINAL_CENSUS
    : { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  return {
    census,
    recountCensus: async () => census,
    releaseIncumbentAdmission: async () => {},
    censusRecord: context.activationRecord,
    // Only the fenced read can reject newer migrated state or rolled-back builds on this unlinked path.
    admitRecord: admitMadangdRecordForIntent(intent, appVersion)
  }
}

// Force can override live terminal counts, never unknown census or protocol deferrals.
export function isForceableMadangdDeferral(code: string): boolean {
  return code === MADANGD_UPDATE_TERMINALS_RUNNING_CODE
}
