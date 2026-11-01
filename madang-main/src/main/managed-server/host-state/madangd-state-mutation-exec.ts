// SSH channel closure does not prove host mutation exit; only command output or exit may release the activation fence.
import { MADANGD_STATE_MUTATION_DEADLINE_SECONDS } from './madangd-state-snapshot'
import {
  MADANGD_STATE_MUTATION_BUSY,
  MADANGD_STATE_MUTATION_DEADLINE
} from './madangd-state-snapshot-members'
import type { MadangdRemoteExecTarget } from '../install/madangd-remote-runtime-control'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { isMadangdFenceLost, MadangdFenceLostError } from '../activation/madangd-activation-fence-scope'

// Let the host deadline kill workload before client observation times out.
export const MADANGD_STATE_MUTATION_CLIENT_TIMEOUT_MS =
  (MADANGD_STATE_MUTATION_DEADLINE_SECONDS + 60) * 1000

function unconfirmed(error: Error): Error & { sshChannelCloseConfirmed: false } {
  return Object.assign(error, { sshChannelCloseConfirmed: false as const })
}

/** Do not abort observation: caller cancellation cannot stop host-side mutation. */
export async function execMadangdStateMutation(
  target: MadangdRemoteExecTarget,
  command: string
): Promise<string> {
  let output: string
  try {
    output = await execCommand(target.conn, command, {
      wrapCommand: target.host.commandDialect !== 'powershell',
      timeoutMs: MADANGD_STATE_MUTATION_CLIENT_TIMEOUT_MS
    })
  } catch (error) {
    // Channel termination flags uncertainty; exit-status errors prove completion.
    if (error instanceof Error && 'sshChannelCloseConfirmed' in error) {
      throw unconfirmed(error)
    }
    throw isMadangdFenceLost(error) ? new MadangdFenceLostError() : error
  }
  const verdict = output.trim().split('\n').pop()?.trim()
  if (verdict === MADANGD_STATE_MUTATION_BUSY) {
    throw unconfirmed(
      new Error('Another snapshot capture or restore is still running on the host.')
    )
  }
  if (verdict === MADANGD_STATE_MUTATION_DEADLINE) {
    throw unconfirmed(
      new Error(
        `A snapshot capture or restore ran past ${MADANGD_STATE_MUTATION_DEADLINE_SECONDS}s and ` +
          'the host stopped it part way through.'
      )
    )
  }
  return output
}

/** Fall back only for finished failures; unconfirmed mutation remains fenced. */
export function execMadangdStateMutationOr(
  target: MadangdRemoteExecTarget,
  command: string,
  fallback = ''
): Promise<string> {
  return execMadangdStateMutation(target, command).catch((error: unknown) => {
    // Lost ownership is a refusal, never a capture failure eligible for fallback.
    if (isUnconfirmedSshCommandTermination(error) || error instanceof MadangdFenceLostError) {
      throw error
    }
    return fallback
  })
}
