/** D1/D2b/D8 reuse SSH installation, activation journals/fences and admission over wsl.exe. C5 pairs through the reported loopback port. */
import { getAppEnvironment } from '../../shared/app-environment'
import type { PairingOffer } from '../../shared/pairing'
import { MADANGD_MANAGED_REMOTE_PORT } from '../../shared/madangd-managed-runtime'
import type { ServeReadiness } from '../server/serve-readiness'
import type { WslHostDeferredUpdate } from '../../shared/wsl-host-types'
import { recoverInterruptedMadangdActivation } from '../managed-server/activation/madangd-activation-recovery'
import { readMadangdActivationRecord } from '../managed-server/activation/madangd-activation-record-store'
import { readMadangdActivationTransaction } from '../managed-server/activation/madangd-activation-transaction-store'
import { materializeMadangdArtifact } from '../madangd/madangd-artifact-materializer'
import { MadangdHostUnsupportedError } from '../madangd/madangd-host-unavailable'
import type { MadangdHostTransport } from '../ssh/madangd-host-transport'
import { MADANGD_ACTIVATION_POLICY_REFUSED_CODE } from '../ssh/madangd-installed-activation'
import { madangdBoundPort } from '../managed-server/lifecycle/madangd-managed-bound-port'
import {
  isForceableMadangdDeferral,
  managedMadangdDeployPolicy,
  managedMadangdInstallDir,
  managedMadangdSlot,
  probeManagedMadangdReadiness
} from '../managed-server/lifecycle/madangd-managed-runtime-context'
import { isWaitingMadangdUpdateDeferral } from '../managed-server/lifecycle/madangd-managed-auto-update'
import { clearMadangdUpdateFailedThisLaunch } from '../managed-server/lifecycle/madangd-managed-update-failure-memory'
import type { MadangdUpdateIntent } from '../managed-server/lifecycle/madangd-managed-update-decision'
import type { MadangdActivationRecord } from '../managed-server/activation/madangd-activation-record'
import { errorMessage } from '../../shared/error-message'
import { pruneManagedMadangdVersions } from '../managed-server/lifecycle/madangd-managed-version-gc'
import { wakeAlreadyActiveMadangd } from '../ssh/madangd-already-active-wake'
import { resolveMadangdRemoteContext } from '../managed-server/install/madangd-remote-context'
import { deployMadangd } from '../ssh/madangd-remote-deploy'
import { MADANGD_PID_FILENAME } from '../managed-server/install/madangd-remote-host-support'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { execCommand } from '../ssh/remote-exec/remote-exec-command'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import { readLocalFullVersion } from '../managed-server/install/remote-versioned-install'
import { createWslDistroHolder, type WslDistroHolder } from './wsl-distro-holder'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import { readWslDistroRegistryIdShared } from './wsl-distro-registry-id'
import type { WslMadangdHostTarget } from './wsl-madangd-host-target'
import { createWslMadangdHostTransport, type WslMadangdHostTransport } from './wsl-madangd-host-transport'
import { readWslMadangdIncumbent, type WslMadangdIncumbent } from './wsl-madangd-incumbent'
import { adoptUnrecordedWslMadangd } from './wsl-madangd-instance-adoption'
import {
  admitWslMadangdLaunch,
  recordWslMadangdUpdateFailure,
  wslMadangdDeferralCode,
  wslMadangdDeferralFailure
} from './wsl-madangd-update-admission'

/** An update this app carries that the host may not take yet; the incumbent keeps serving. */
export type WslMadangdDeferredUpdate = WslHostDeferredUpdate

export type WslMadangdLaunch =
  | {
      outcome: 'ready'
      distro: string
      /** The Lxss registration GUID for the deployment record's `distroId`; null if unreadable. */
      distroId: string | null
      /** The loopback port madangd bound inside the distro (another one when the preferred was taken). */
      port: number
      fullVersion: string
      pid: number | null
      readiness: ServeReadiness
      holder: 'adopted' | 'spawned' | 'unverifiable'
      /** An madangd the record did not name (e.g. left by a failed Remove), now recorded. */
      adoptedInstance?: { version: string; pid: number }
      /** Set when `fullVersion` is the incumbent because the update must wait. */
      deferredUpdate?: WslMadangdDeferredUpdate
    }
  | ({ outcome: 'deferred'; distro: string } & WslMadangdDeferredUpdate)

export type WslMadangdDeployOptions = {
  /** The WSL environment's id; keys host-scoped state (wake dedupe). Defaults per distro. */
  environmentId?: string
  label?: string
  /** Defaults to a connect. */
  intent?: MadangdUpdateIntent
  signal?: AbortSignal
  /** Defaults to one created over `userData`; the app should pass its shared instance. */
  holder?: WslDistroHolder
  createTransport?: (target: WslMadangdHostTarget) => MadangdHostTransport & { dispose?(): void }
  readRegistryId?: (distro: string) => Promise<string | null>
  readIncumbent?: typeof readWslMadangdIncumbent
  /** This desktop's enrolled pairing, which the incumbent's terminal count authenticates with. */
  pairedOffer?: PairingOffer | null
  /** The madangd template to deploy from; defaults to the packaged one (the C10 lane swaps it). */
  templateDir?: string
}

/** Until the persisted deployment record (C7) assigns one, the environment is keyed per distro. */
export function defaultWslMadangdEnvironmentId(distro: string): string {
  return `wsl:${wslDistroHolderKey(distro)}`
}

/** WSL 1 runs no Linux kernel, so the pinned Node and its pty cannot run there. */
export function isWsl1KernelRelease(release: string): boolean {
  return /^\d+\.\d+\.\d+-\d+-Microsoft$/.test(release.trim())
}

export async function deployAndLaunchWslMadangd(
  distro: string,
  options: WslMadangdDeployOptions = {}
): Promise<WslMadangdLaunch> {
  const name = distro.trim()
  if (!name) {
    throw new Error('A WSL distro name is required')
  }
  const target: WslMadangdHostTarget = {
    kind: 'wsl',
    id: options.environmentId ?? defaultWslMadangdEnvironmentId(name),
    distro: name,
    label: options.label ?? name
  }
  const conn = (options.createTransport ?? defaultTransport)(target)
  try {
    return await launchOverTransport(name, target, conn, options)
  } finally {
    conn.dispose?.()
  }
}

async function launchOverTransport(
  name: string,
  target: WslMadangdHostTarget,
  conn: MadangdHostTransport,
  options: WslMadangdDeployOptions
): Promise<WslMadangdLaunch> {
  const { signal } = options
  const kernel = await execCommand(conn, 'uname -r', { signal })
  if (isWsl1KernelRelease(kernel)) {
    throw new MadangdHostUnsupportedError(
      `The WSL 1 distro ${name} isn’t supported by Madang’s server. ` +
        `Convert it with: wsl --set-version ${name} 2`
    )
  }
  // Acquire a holder before launch or WSL can idle-stop madangd's distro.
  const holder = options.holder ?? createWslDistroHolder({ userDataPath: userDataPath() })
  const held = await holder.ensureHeld(name)
  // Read GUID alongside deploy; failure leaves the record without one.
  const distroId = (options.readRegistryId ?? readWslDistroRegistryIdShared)(name).catch(() => null)
  let context = await resolveMadangdRemoteContext(target, conn, signal)
  const slot = managedMadangdSlot(context, MADANGD_MANAGED_REMOTE_PORT, signal)
  const recovery = await recoverInterruptedMadangdActivation(slot)
  if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
    throw new Error(recovery.reason)
  }
  if (recovery.outcome === 'recovered') {
    context = { ...context, activationRecord: await readMadangdActivationRecord(slot) }
  }
  // Adopt unrecorded madangd before deploy/wake or its instance lock blocks launch.
  const adoption = await adoptUnrecordedWslMadangd(slot, context.activationRecord)
  if (adoption.outcome === 'adopted') {
    context = { ...context, activationRecord: adoption.record }
  }
  const localMadangdDir = await materializeMadangdArtifact(context.serverTarget, {
    signal,
    trustVerificationRecord: true,
    ...(options.templateDir ? { templateDir: options.templateDir } : {})
  })
  const appVersion = getAppEnvironment().getVersion()
  const candidateVersion = readLocalFullVersion(localMadangdDir)
  const failureHost = { kind: 'wsl', id: target.id } as const
  const intent = options.intent ?? 'connect'
  const admit = (record: MadangdActivationRecord, admitIntent: MadangdUpdateIntent) =>
    admitWslMadangdLaunch(
      { slot, record, candidateVersion, appVersion, host: failureHost, intent: admitIntent },
      name,
      readyLaunch
    )
  const admitted = await admit(context.activationRecord, intent)
  if ('outcome' in admitted) {
    return admitted
  }
  context = { ...context, activationRecord: admitted }
  const incumbentVersion = context.activationRecord.active
  // Only version changes need incumbent census; same-version connects deploy as no-ops.
  const incumbent: WslMadangdIncumbent | null =
    incumbentVersion && incumbentVersion !== candidateVersion
      ? await (options.readIncumbent ?? readWslMadangdIncumbent)({
          context,
          slot,
          paired: options.pairedOffer ?? null
        })
      : null
  const deployed = await deployMadangd({
    ...slot,
    conn,
    localMadangdDir,
    target: context.serverTarget,
    ...managedMadangdDeployPolicy(context, appVersion, intent),
    ...(incumbent
      ? {
          census: incumbent.census,
          recountCensus: incumbent.recount,
          releaseIncumbentAdmission: incumbent.releaseAdmission
        }
      : {}),
    force: intent === 'force',
    appVersion,
    recordedNodeRuntimeProbe: true
  }).catch((error: unknown) => {
    if (!signal?.aborted) {
      recordWslMadangdUpdateFailure(failureHost, incumbentVersion, {
        code: 'madangd_update_failed',
        reason: errorMessage(error)
      })
    }
    throw error
  })
  if (deployed.outcome === 'installed-not-activated') {
    const failure = wslMadangdDeferralFailure(deployed)
    recordWslMadangdUpdateFailure(failureHost, incumbentVersion, failure)
    const restored = incumbentVersion && failure ? await readRestoredRecord(incumbentVersion) : null
    if (restored) {
      // After rollback proof, serve the restored incumbent on this connect too.
      const retried = await admit(restored, 'connect')
      if ('outcome' in retried) {
        return retried
      }
    }
    const deferredUpdate: WslMadangdDeferredUpdate = {
      candidateVersion: deployed.fullVersion,
      code: await wslMadangdDeferralCode(slot, deployed, appVersion),
      reason: deployed.reason,
      forceable:
        isForceableMadangdDeferral(deployed.code) ||
        deployed.code === MADANGD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Live-terminal deferrals keep the incumbent serving until Update/Force.
    if (
      incumbentVersion &&
      incumbent?.readiness &&
      isWaitingMadangdUpdateDeferral(deployed.code) &&
      // Another client may have activated since census; refuse stale incumbent assumptions.
      (await readMadangdActivationRecord(slot)).active === incumbentVersion
    ) {
      const serving = {
        fullVersion: incumbentVersion,
        readiness: incumbent.readiness
      }
      return { ...(await readyLaunch(serving)), deferredUpdate }
    }
    return { outcome: 'deferred', distro: name, ...deferredUpdate }
  }
  clearMadangdUpdateFailedThisLaunch(failureHost)
  if (deployed.outcome === 'already-active') {
    // A stopped distro ended the active slot with it.
    await wakeAlreadyActiveMadangd(slot)
  }
  const readiness = await probeManagedMadangdReadiness(
    context,
    localMadangdDir,
    deployed.fullVersion,
    signal
  )
  await pruneManagedMadangdVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployed.fullVersion,
    readiness
  })
  return readyLaunch({ fullVersion: deployed.fullVersion, readiness })

  /** The record only once the incumbent is back and no journal awaits recovery; else null. */
  async function readRestoredRecord(incumbent: string): Promise<MadangdActivationRecord | null> {
    // Unreadable transaction state proves no restoration; preserve the rejection.
    if (await readMadangdActivationTransaction(slot).catch(() => true)) {
      return null
    }
    const record = await readMadangdActivationRecord(slot).catch(() => null)
    return record?.active === incumbent ? record : null
  }

  async function readyLaunch(serving: {
    fullVersion: string
    readiness: ServeReadiness
  }): Promise<Extract<WslMadangdLaunch, { outcome: 'ready' }>> {
    const pidFile = joinRemotePath(
      context.host,
      managedMadangdInstallDir(context, serving.fullVersion),
      MADANGD_PID_FILENAME
    )
    const pid = Number.parseInt(
      await execCommand(conn, `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`, { signal }),
      10
    )
    return {
      outcome: 'ready',
      distro: name,
      distroId: await distroId,
      port: madangdBoundPort(serving.readiness) ?? MADANGD_MANAGED_REMOTE_PORT,
      fullVersion: serving.fullVersion,
      pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
      readiness: serving.readiness,
      holder: held.outcome,
      ...(adoption.outcome === 'adopted'
        ? { adoptedInstance: { version: adoption.version, pid: adoption.pid } }
        : {})
    }
  }
}

function defaultTransport(target: WslMadangdHostTarget): WslMadangdHostTransport {
  return createWslMadangdHostTransport({ target })
}

function userDataPath(): string {
  return getAppEnvironment().getPath('userData')
}
