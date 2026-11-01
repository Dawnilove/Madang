/** Only positive host evidence proves slot exit. Unanswered probes stay unverifiable and never authorize starting a second slot. */
import type { ServeReadiness } from '../server/serve-readiness'
import type { MadangdActivationExpectation } from '../managed-server/activation/madangd-activation-gate'
import { MADANGD_INSTALL_MODEL } from '../managed-server/install/remote-install-model'
import { computeRemoteInstallDir } from '../managed-server/install/remote-versioned-install'
import { readRemoteMadangdBuildHash } from '../managed-server/install/madangd-remote-build-hash'
import {
  launchMadangdSlotAndAwaitReadiness,
  MadangdActiveReadinessError,
  probeActiveMadangdReadiness
} from './madangd-active-readiness'
import {
  madangdLivenessProbeCommand,
  madangdLivenessProvenExited,
  parseMadangdLiveness,
  type MadangdLiveness
} from '../managed-server/install/madangd-remote-launch'
import {
  parseMadangdStopOutcome,
  stopMadangdCommand,
  type MadangdStopOutcome
} from '../managed-server/install/madangd-remote-process-control'
import {
  execMadangdRemote,
  type MadangdRemoteExecTarget
} from '../managed-server/install/madangd-remote-runtime-control'
import { madangdActivationTransactionRoot } from '../managed-server/activation/madangd-activation-transaction'
import {
  initialMadangdActivationAdmissionCommand,
  parseInitialMadangdActivationAdmission
} from './madangd-initial-activation-admission'

export const MADANGD_SLOT_STOP_WAIT_SECONDS = 20

export type MadangdSlotOptions = MadangdRemoteExecTarget & {
  remoteHome: string
  /** Host Node for legacy slots only; a slot's own runtime marker wins. */
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  readinessTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type MadangdSlotIdentity = { version: string; remoteDir: string; buildHash: string }

function expectation(identity: MadangdSlotIdentity): MadangdActivationExpectation {
  return { buildHash: identity.buildHash, fullVersion: identity.version }
}

export function madangdSlotDir(options: MadangdSlotOptions, version: string): string {
  return computeRemoteInstallDir(MADANGD_INSTALL_MODEL, options.remoteHome, version)
}

/** Hash installed bytes so readiness must prove the same build. */
export async function resolveMadangdSlotIdentity(
  options: MadangdSlotOptions,
  version: string
): Promise<MadangdSlotIdentity> {
  const remoteDir = madangdSlotDir(options, version)
  return { version, remoteDir, buildHash: await readRemoteMadangdBuildHash(options, remoteDir) }
}

export function launchMadangdSlot(
  options: MadangdSlotOptions,
  identity: MadangdSlotIdentity
): Promise<ServeReadiness> {
  return launchMadangdSlotAndAwaitReadiness(
    options,
    {
      remoteInstallDir: identity.remoteDir,
      nodePath: options.nodePath,
      fullVersion: identity.version,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      // Every SSH launch is client-managed, so every one may idle out and be woken on connect.
      activationRoot: madangdActivationTransactionRoot(options.host, options.remoteHome)
    },
    expectation(identity)
  )
}

/** Proves the slot serves, starting it only on proven exit. */
export async function ensureMadangdSlotServing(
  options: MadangdSlotOptions,
  identity: MadangdSlotIdentity
): Promise<ServeReadiness> {
  const liveness = parseMadangdLiveness(
    await execMadangdRemote(options, madangdLivenessProbeCommand(options.host, identity.remoteDir))
  )
  if (liveness === 'LIVE') {
    return probeActiveMadangdReadiness(
      { ...options, remoteInstallDir: identity.remoteDir },
      expectation(identity)
    )
  }
  if (!madangdLivenessProvenExited(liveness)) {
    throw new MadangdActiveReadinessError(
      'unverifiable',
      `madangd ${identity.version} process state is unverifiable.`
    )
  }
  return launchMadangdSlot(options, identity)
}

/** `justLaunched` only for a slot this run started; otherwise the readiness PID must agree. */
export async function stopMadangdSlot(
  options: MadangdSlotOptions,
  remoteDir: string,
  justLaunched: boolean
): Promise<MadangdStopOutcome> {
  return parseMadangdStopOutcome(
    await execMadangdRemote(
      options,
      stopMadangdCommand(
        options.host,
        remoteDir,
        justLaunched
          ? { waitSeconds: MADANGD_SLOT_STOP_WAIT_SECONDS, justLaunched: true }
          : { waitSeconds: MADANGD_SLOT_STOP_WAIT_SECONDS, nodePath: options.nodePath }
      )
    )
  )
}

type MadangdSlotQuiescence = 'exited' | 'other-slot-serving'

/** Prove candidate exit before replacing state and rule out another running slot, unless it already serves. Missing PID files prove nothing: SSH may drop after nohup but before $! is recorded, so inspect data-root ownership. */
export async function quiesceInterruptedMadangdSlot(
  options: MadangdSlotOptions,
  /** `null` when nothing was launched, so only `otherSlot` needs ruling out. */
  version: string | null,
  otherSlot: MadangdSlotIdentity | null
): Promise<MadangdSlotQuiescence> {
  const remoteDir = version === null ? null : madangdSlotDir(options, version)
  const stopped =
    remoteDir === null ? 'already-exited' : await stopMadangdSlot(options, remoteDir, false)
  let exited = stopped === 'stopped' || stopped === 'already-exited'
  if ((stopped === 'unknown' || stopped === 'unconfirmed') && remoteDir !== null) {
    // No verified answer, e.g. the slot died before readiness; liveness decides.
    exited = madangdLivenessProvenExited(await slotLiveness(options, remoteDir))
  }
  if (otherSlot) {
    const other = await slotLiveness(options, otherSlot.remoteDir)
    if (other === 'LIVE' && (exited || stopped === 'no-pid')) {
      // The serving slot holds the instance lock, so a PID-less launch cannot own the state.
      await probeActiveMadangdReadiness(
        { ...options, remoteInstallDir: otherSlot.remoteDir },
        expectation(otherSlot)
      )
      return 'other-slot-serving'
    }
    if (!madangdLivenessProvenExited(other)) {
      throw new MadangdActiveReadinessError(
        'unverifiable',
        `madangd ${version ?? 'candidate'} (${stopped}) and ${otherSlot.version} (${other}) cannot both be ` +
          'ruled out as owners of the shared state; it was not replaced.'
      )
    }
  }
  if (!exited && stopped === 'no-pid' && remoteDir !== null) {
    const admission = parseInitialMadangdActivationAdmission(
      await execMadangdRemote(
        options,
        initialMadangdActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    exited = admission.decision === 'proceed'
  }
  if (!exited) {
    throw new MadangdActiveReadinessError(
      'unverifiable',
      `madangd ${version ?? 'candidate'} could not be confirmed stopped (${stopped}); replacing its state would be unsafe.`
    )
  }
  return 'exited'
}

export async function slotLiveness(
  options: MadangdSlotOptions,
  remoteDir: string
): Promise<MadangdLiveness> {
  return parseMadangdLiveness(
    await execMadangdRemote(options, madangdLivenessProbeCommand(options.host, remoteDir))
  )
}
