import {
  evaluateMadangdActivation,
  type MadangdActivationExpectation
} from '../managed-server/activation/madangd-activation-gate'
import {
  madangdLivenessProbeCommand,
  parseMadangdLiveness,
  type MadangdLaunchSpec,
  type MadangdReadinessParse
} from '../managed-server/install/madangd-remote-launch'
import {
  execMadangdRemote,
  launchMadangdAndAwaitReadiness,
  type MadangdRemoteExecTarget
} from '../managed-server/install/madangd-remote-runtime-control'
import {
  parseMadangdReadinessWaitOutput,
  readMadangdReadinessNowCommand
} from '../managed-server/install/madangd-remote-readiness-wait'
import type { ServeReadiness } from '../server/serve-readiness'
import { withMadangdLogTail } from '../managed-server/install/madangd-remote-log-tail'

type MadangdReadinessFailureVerdict = 'exited' | 'unverifiable' | 'rejected'

export class MadangdActiveReadinessError extends Error {
  constructor(
    readonly verdict: MadangdReadinessFailureVerdict,
    message: string
  ) {
    super(message)
    this.name = 'MadangdActiveReadinessError'
  }
}

function gatedReadiness(
  parsed: MadangdReadinessParse,
  expectation: MadangdActivationExpectation,
  label: string
): ServeReadiness {
  const readiness = parsed.state === 'ready' ? parsed.readiness : null
  const verdict = evaluateMadangdActivation(readiness, expectation)
  if (verdict.decision === 'reject') {
    throw new MadangdActiveReadinessError(
      'rejected',
      `${label} failed its readiness check: ${verdict.reason}`
    )
  }
  if (!readiness) {
    throw new MadangdActiveReadinessError(
      'rejected',
      `${label} passed activation without a readiness payload.`
    )
  }
  const coverage = madangdDaemonCoverageRefusal(readiness)
  if (coverage) {
    throw new MadangdActiveReadinessError('rejected', `${label} ${coverage}`)
  }
  return readiness
}

/** Require PTY self-test coverage, or handshake on platforms that cannot spawn-probe. Older slots without coverage metadata retain the identity-only gate. */
function madangdDaemonCoverageRefusal(readiness: ServeReadiness): string | null {
  const health = readiness.health
  const coverage = health?.terminalDaemon?.selfTest?.coverage
  if (!health || coverage === undefined || coverage === 'pty-spawn') {
    return null
  }
  if (coverage === 'handshake' && health.platform === 'win32') {
    return null
  }
  return (
    `reported terminal-daemon coverage '${String(coverage)}', which does not prove a PTY can ` +
    `be created on ${health.platform}.`
  )
}

export async function probeActiveMadangdReadiness(
  target: MadangdRemoteExecTarget & { remoteInstallDir: string },
  expectation: MadangdActivationExpectation
): Promise<ServeReadiness> {
  const liveness = parseMadangdLiveness(
    await execMadangdRemote(target, madangdLivenessProbeCommand(target.host, target.remoteInstallDir))
  )
  if (liveness === 'DEAD') {
    throw new MadangdActiveReadinessError(
      'exited',
      `madangd ${expectation.fullVersion} is recorded active but its process has exited.`
    )
  }
  if (liveness === 'NEVER_LAUNCHED') {
    throw new MadangdActiveReadinessError(
      'exited',
      `madangd ${expectation.fullVersion} is recorded active but was never started from its install directory.`
    )
  }
  if (liveness !== 'LIVE') {
    throw new MadangdActiveReadinessError(
      'unverifiable',
      `madangd ${expectation.fullVersion} process state is unverifiable.`
    )
  }
  const parsed = parseMadangdReadinessWaitOutput(
    target.host,
    await execMadangdRemote(
      target,
      readMadangdReadinessNowCommand(target.host, target.remoteInstallDir)
    )
  )
  return gatedReadiness(parsed, expectation, 'The active madangd')
}

/** Accept recovery/rollback launches only when they prove the expected build. */
export async function launchMadangdSlotAndAwaitReadiness(
  target: MadangdRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: MadangdLaunchSpec,
  expectation: MadangdActivationExpectation
): Promise<ServeReadiness> {
  const parsed = await launchMadangdAndAwaitReadiness(target, spec)
  try {
    return gatedReadiness(parsed, expectation, `madangd ${spec.fullVersion}`)
  } catch (error) {
    if (!(error instanceof MadangdActiveReadinessError)) {
      throw error
    }
    const message = await withMadangdLogTail(target, spec.remoteInstallDir, error.message)
    throw new MadangdActiveReadinessError(error.verdict, message)
  }
}
