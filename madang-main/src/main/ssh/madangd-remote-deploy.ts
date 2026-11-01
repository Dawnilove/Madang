/** Activate under a durable host fence/journal only after candidate readiness. Recover the incumbent only with safe profile state; retain changed state/snapshot for explicit recovery. */
import { logMadangdActivationOutcome } from '../managed-server/activation/madangd-activation-outcome-log'
import { join } from 'node:path'
import type { MadangdHostTransport } from './madangd-host-transport'
import type { MadangdUpdateForce } from './madangd-update-plan'
import { MADANGD_INSTALL_MODEL } from '../managed-server/install/remote-install-model'
import {
  computeRemoteInstallDir,
  readLocalFullVersion
} from '../managed-server/install/remote-versioned-install'
import { readMadangdActivationRecord } from '../managed-server/activation/madangd-activation-record-store'
import type { MadangdActivationRecord } from '../managed-server/activation/madangd-activation-record'
import type { MadangdActivationVerdict } from '../managed-server/activation/madangd-activation-gate'
import type { MadangdTerminalCensus } from '../../shared/madangd-terminal-census'
import type { RemoteHostPlatform } from './ssh-remote-platform'
import { installMadangdBundle } from '../managed-server/install/madangd-remote-install'
import { getAppEnvironment } from '../../shared/app-environment'
import type { NodeRuntimeTarget } from '../../shared/node-runtime-pin'
import { MADANGD_STARTUP_READINESS_TIMEOUT_MS } from '../../shared/madangd-profile-preflight'
import { materializeMadangdArtifact } from '../madangd/madangd-artifact-materializer'
import { readMadangdBundleTarget } from './madangd-deployment-target'
import { resolveMadangdRuntimeTarget } from '../managed-server/lifecycle/madangd-runtime-target'
import {
  materializeNodeRuntimeArchive,
  nodeRuntimeArchiveCachePath
} from '../node-runtime/pinned-runtime-materializer'
import {
  madangdActivationFenceExists,
  resolveMadangdActivationReadinessTimeout,
  withMadangdActivationLock
} from '../managed-server/activation/madangd-activation-lock'
import { activateInstalledMadangd } from './madangd-installed-activation'
import { madangdActivationFenceRefusal } from '../managed-server/activation/madangd-activation-fence-hold'

export type MadangdDeployOptions = {
  conn: MadangdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  /** An already assembled bundle; otherwise materialize the packaged template for this host. */
  localMadangdDir?: string
  /** The bundle's runtime target; read from `localMadangdDir` or probed when absent. */
  target?: NodeRuntimeTarget
  /** Where the pinned runtime archive is cached; defaults beside the madangd artifact cache. */
  runtimeCacheRoot?: string
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  /** Caller supplies a protocol-aware census; unanswered host evidence must never become zero live terminals. */
  census: MadangdTerminalCensus
  /** Bind census to its incumbent record; a changed locked record makes earlier counts unverifiable. */
  censusRecord?: MadangdActivationRecord
  /** Recount under fence just before stopping the same incumbent; uploads may outdate initial counts and failures stay unverifiable. */
  recountCensus: () => Promise<MadangdTerminalCensus>
  /** Best-effort reopen when incumbent keeps serving; admission also expires server-side. */
  releaseIncumbentAdmission: () => Promise<void>
  force?: MadangdUpdateForce
  /** The Orca app version activating, recorded so an older client never downgrades the host. */
  appVersion?: string
  /** Reapply version policy under lock because peer activation/stop may land during upload. */
  admitRecord?: (record: MadangdActivationRecord, candidateVersion: string) => string | null
  readinessTimeoutMs?: number
  /** WSL only; SSH hosts always re-hash the runtime (see `installMadangdBundle`). */
  recordedNodeRuntimeProbe?: boolean
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type MadangdDeployResult =
  | { outcome: 'installed-and-activated'; fullVersion: string; verdict: MadangdActivationVerdict }
  | { outcome: 'already-active'; fullVersion: string }
  | { outcome: 'installed-not-activated'; fullVersion: string; code: string; reason: string }

export async function deployMadangd(
  input: MadangdDeployOptions,
  retryClearedFence = true
): Promise<MadangdDeployResult> {
  const target =
    input.target ??
    (input.localMadangdDir
      ? readMadangdBundleTarget(input.localMadangdDir)
      : await resolveMadangdRuntimeTarget(input))
  const runtimeCacheRoot =
    input.runtimeCacheRoot ?? join(getAppEnvironment().getPath('userData'), 'madangd-artifacts')
  const options = {
    ...input,
    target,
    readinessTimeoutMs: resolveMadangdActivationReadinessTimeout(
      input.readinessTimeoutMs,
      MADANGD_STARTUP_READINESS_TIMEOUT_MS
    ),
    nodeRuntimeArchive: () =>
      materializeNodeRuntimeArchive(target, runtimeCacheRoot, { signal: input.signal }),
    nodeRuntimeOfflineArchivePath: nodeRuntimeArchiveCachePath(target, runtimeCacheRoot),
    localMadangdDir:
      input.localMadangdDir ?? (await materializeMadangdArtifact(target, { signal: input.signal }))
  }
  const fullVersion = readLocalFullVersion(options.localMadangdDir)
  const remoteDir = computeRemoteInstallDir(MADANGD_INSTALL_MODEL, options.remoteHome, fullVersion)
  const held = async (): Promise<MadangdDeployResult> => {
    const { cleared, ...refusal } = await madangdActivationFenceRefusal(options, 'update')
    // Retry one cleared abandoned fence; repeated abandonment must surface to the caller.
    if (cleared && retryClearedFence) {
      return deployMadangd({ ...input, target, localMadangdDir: options.localMadangdDir }, false)
    }
    return { outcome: 'installed-not-activated', fullVersion, ...refusal }
  }
  // Refuse before upload, then re-read both admission inputs under fence.
  const preUploadRecord = await readMadangdActivationRecord(options)
  const censusRecord = options.censusRecord ?? preUploadRecord
  // An unanswered probe only skips this shortcut; lock acquisition still arbitrates.
  if (await madangdActivationFenceExists(options).catch(() => false)) {
    return held()
  }

  await installMadangdBundle(options, fullVersion, remoteDir)

  return logMadangdActivationOutcome(
    `update to ${fullVersion}`,
    () =>
      withMadangdActivationLock(
        options,
        (lock) =>
          activateInstalledMadangd({ ...options, censusRecord }, fullVersion, remoteDir, lock),
        held
      ),
    ['installed-and-activated', 'already-active']
  )
}
