import {
  evaluateMadangdActivation,
  type MadangdActivationVerdict
} from '../managed-server/activation/madangd-activation-gate'
import { madangdActivationTransactionRoot } from '../managed-server/activation/madangd-activation-transaction'
import type { MadangdReadinessParse } from '../managed-server/install/madangd-remote-launch'
import {
  launchMadangdAndAwaitReadiness,
  type MadangdRemoteExecTarget
} from '../managed-server/install/madangd-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'

type CandidateLaunchTarget = Parameters<typeof launchMadangdAndAwaitReadiness>[0] &
  MadangdRemoteExecTarget & {
    remoteHome: string
    nodePath: string
    userDataDir: string
    bindHost: string
    port: number
  }

/** Rethrow unconfirmed SSH cleanup: it provides no candidate evidence and must never mean rejection. */
export async function launchAndJudgeMadangdSlot(
  options: CandidateLaunchTarget,
  slot: { remoteInstallDir: string; fullVersion: string; buildHash: string }
): Promise<{ verdict: MadangdActivationVerdict; launchError: unknown }> {
  let parsed: MadangdReadinessParse | null = null
  let launchError: unknown
  try {
    parsed = await launchMadangdAndAwaitReadiness(options, {
      remoteInstallDir: slot.remoteInstallDir,
      nodePath: options.nodePath,
      fullVersion: slot.fullVersion,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      activationRoot: madangdActivationTransactionRoot(options.host, options.remoteHome)
    })
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    launchError = error
  }
  const verdict = evaluateMadangdActivation(parsed?.state === 'ready' ? parsed.readiness : null, {
    buildHash: slot.buildHash,
    fullVersion: slot.fullVersion
  })
  return { verdict, launchError }
}
