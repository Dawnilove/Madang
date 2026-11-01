/** Daemon terminals survive madangd swaps and may retain the outgoing bundle, so keep its directory. Shared state migrates in place without schema versions; safe rollback therefore restores a pre-activation snapshot rather than comparing build versions. */
import type { MadangdActivationRecord } from '../managed-server/activation/madangd-activation-record'
import type { MadangdTerminalCensus } from '../../shared/madangd-terminal-census'
import {
  assessMadangdLiveDaemonCrossing,
  type MadangdDaemonProtocolFacts
} from './madangd-daemon-protocol-crossing'

type MadangdUpdateDecision =
  | { action: 'noop'; reason: string }
  | {
      action: 'proceed'
      preservesLiveDaemon: boolean
      notes: string[]
    }
  | { action: 'defer'; code: MadangdUpdateDeferCode; reason: string }

/** `live-terminals` passes only a counted live-terminal deferral, never an uncounted census. */
export type MadangdUpdateForce = boolean | 'live-terminals'

export type MadangdUpdateDeferCode =
  | 'madangd_update_terminals_running'
  | 'madangd_update_terminal_census_unavailable'
  | 'madangd_update_strands_live_terminals'
  | 'madangd_update_daemon_protocol_unverifiable'
  | 'madangd_update_ends_in_process_terminals'

/** Defer live-session mixed-build pairs unless the operator chooses force; force cannot authorize an unsupported daemon protocol. */
export function planMadangdUpdate(input: {
  record: MadangdActivationRecord
  candidateVersion: string
  census: MadangdTerminalCensus
  candidateDaemonProtocol: MadangdDaemonProtocolFacts
  force?: MadangdUpdateForce
}): MadangdUpdateDecision {
  if (input.record.active === input.candidateVersion) {
    return {
      action: 'noop',
      reason: `${input.candidateVersion} is already the active version; nothing to restart.`
    }
  }
  const inProcess = input.census.inProcessSessions ?? 0
  // In-process terminals cannot survive restart; force cannot override this even if daemon census is empty.
  if (inProcess > 0) {
    return {
      action: 'defer',
      code: 'madangd_update_ends_in_process_terminals',
      reason:
        `${inProcess} terminal${inProcess === 1 ? ' runs' : 's run'} inside the madangd process ` +
        'itself because its terminal daemon is degraded. Any restart ends ' +
        `${inProcess === 1 ? 'it' : 'them'}, and forcing the update cannot keep ` +
        `${inProcess === 1 ? 'it' : 'them'} alive. Close ${inProcess === 1 ? 'it' : 'them'}, ` +
        'then update.'
    }
  }
  const crossing = assessMadangdLiveDaemonCrossing(input.census, input.candidateDaemonProtocol)
  // Force can accept mixed builds, never unreachable terminals.
  if (crossing === 'strands-live-terminals') {
    return {
      action: 'defer',
      code: 'madangd_update_strands_live_terminals',
      reason:
        `The live terminal daemon speaks protocol ${String(input.census.daemonProtocolVersion)}, ` +
        `which madangd ${input.candidateVersion} cannot attach to. Restarting now would leave ` +
        'every running terminal unreachable. Update when no terminals are running.'
    }
  }
  const { liveSessions } = input.census
  if (input.force && crossing === 'unverifiable') {
    return {
      action: 'defer',
      code: 'madangd_update_daemon_protocol_unverifiable',
      reason:
        'The terminal daemon did not report its protocol, so this update cannot show that ' +
        `madangd ${input.candidateVersion} will reach the terminals it is forced past. Retry ` +
        'when the daemon answers.'
    }
  }
  if (liveSessions === null) {
    if (input.force !== true) {
      return {
        action: 'defer',
        code: 'madangd_update_terminal_census_unavailable',
        reason:
          'The terminal daemon did not answer a session count, so this update cannot tell ' +
          'whether work is running on the host. Retry, or force the update knowing terminals ' +
          'may be mid-flight.'
      }
    }
    return {
      action: 'proceed',
      // Unknown census must preserve possible live sessions; never assume the daemon replaceable.
      preservesLiveDaemon: true,
      notes: [
        'Forced with an unverifiable session count. Planning as if terminals are live: the ' +
          'daemon will be preserved across the restart, and the outgoing version directory ' +
          'stays pinned against GC.'
      ]
    }
  }
  if (liveSessions > 0 && !input.force) {
    return {
      action: 'defer',
      code: 'madangd_update_terminals_running',
      reason:
        `${liveSessions} terminal${liveSessions === 1 ? ' is' : 's are'} running on this host. ` +
        'The restart would not kill them — the daemon is preserved — but the host would run ' +
        `madangd ${input.candidateVersion} against a daemon forked from ` +
        `${input.record.active ?? 'the previous build'} until they all exit. Update when the ` +
        'host is idle, or force it.'
    }
  }
  if (liveSessions > 0) {
    return {
      action: 'proceed',
      preservesLiveDaemon: true,
      notes: [
        `Forced with ${liveSessions} live terminal${liveSessions === 1 ? '' : 's'}. They survive ` +
          'the restart on the existing daemon; the outgoing version directory stays pinned ' +
          'against GC because that daemon was forked from it.'
      ]
    }
  }
  return {
    action: 'proceed',
    // At zero sessions daemon-init can safely replace the old daemon.
    preservesLiveDaemon: false,
    notes: [
      'No terminals are running, so the daemon is replaced by one forked from the new bundle.'
    ]
  }
}

type MadangdRollbackSafety =
  | { safety: 'clean'; target: string; notes: string[] }
  | { safety: 'lossy'; target: string; discards: string[] }
  | { safety: 'unsafe'; code: MadangdRollbackUnsafeCode; reason: string }

type MadangdRollbackUnsafeCode =
  | 'madangd_rollback_no_target'
  | 'madangd_rollback_snapshot_missing'
  | 'madangd_rollback_orphans_live_terminals'
  | 'madangd_rollback_census_unavailable'
  | 'madangd_rollback_snapshot_unverifiable'
  | 'madangd_rollback_strands_live_terminals'
  | 'madangd_rollback_daemon_protocol_unverifiable'

/** Restoring a pre-activation snapshot discards later state. Post-activation terminal creation makes rollback unsafe: the surviving daemon would own PTYs absent from restored rows. Settings/UI-only changes are merely lossy. */
export function assessMadangdRollback(input: {
  record: MadangdActivationRecord
  /** Whether the snapshot is still on the host; `null` means the probe was unverifiable. */
  snapshotPresent: boolean | null
  census: MadangdTerminalCensus
  /** The rollback target's daemon protocol facts, from the client's copy of its bytes. */
  targetDaemonProtocol: MadangdDaemonProtocolFacts
  /** Compare shared-store mtime to activation; unknown writes are treated as present rather than claiming unproven lossless rollback. */
  stateWritesSinceActivation: boolean | null
}): MadangdRollbackSafety {
  const target = input.record.previous
  if (!target) {
    return {
      safety: 'unsafe',
      code: 'madangd_rollback_no_target',
      reason:
        'This host has no previous madangd version recorded, so there is nothing to roll back ' +
        'to. Deploy a known-good build instead.'
    }
  }
  if (input.record.snapshot && input.snapshotPresent === null) {
    return {
      safety: 'unsafe',
      code: 'madangd_rollback_snapshot_unverifiable',
      reason:
        'The host did not give a trustworthy answer about the pre-activation snapshot. Retry ' +
        'when the host is reachable; loss of contact is not evidence the snapshot is gone.'
    }
  }
  if (!input.record.snapshot || !input.snapshotPresent) {
    return {
      safety: 'unsafe',
      code: 'madangd_rollback_snapshot_missing',
      reason:
        `The pre-activation state snapshot for ${input.record.active ?? 'the active version'} ` +
        'is gone, and Madang state carries no schema version that could prove the older build ' +
        'can read what the newer one migrated. Switching the binary back would hand ' +
        `${target} a store it may not understand. Deploy forward instead.`
    }
  }
  const { startedSinceActivation } = input.census
  if (startedSinceActivation === null) {
    return {
      safety: 'unsafe',
      code: 'madangd_rollback_census_unavailable',
      reason:
        'The daemon did not answer how many of its terminals started after this version was ' +
        'activated, so a snapshot restore might orphan running work. Retry when the host is ' +
        'reachable.'
    }
  }
  if (startedSinceActivation > 0) {
    return {
      safety: 'unsafe',
      code: 'madangd_rollback_orphans_live_terminals',
      reason:
        `${startedSinceActivation} terminal${startedSinceActivation === 1 ? '' : 's'} started ` +
        'after this version was activated. The daemon survives the rollback and would keep ' +
        'owning them, but the restored snapshot predates them, so nothing would be able to ' +
        'reattach. Close them (or let them exit) and roll back then.'
    }
  }
  const crossing = assessMadangdLiveDaemonCrossing(input.census, input.targetDaemonProtocol)
  if (crossing === 'unverifiable') {
    return {
      safety: 'unsafe',
      code: 'madangd_rollback_daemon_protocol_unverifiable',
      reason:
        'The terminal daemon did not report its protocol, so this rollback cannot show that ' +
        `${target} would reach the terminals still running. Retry when the daemon answers.`
    }
  }
  if (crossing === 'strands-live-terminals') {
    return {
      safety: 'unsafe',
      code: 'madangd_rollback_strands_live_terminals',
      reason:
        `The live terminal daemon speaks protocol ${String(input.census.daemonProtocolVersion)}, ` +
        `which ${target} does not list. Rolling back now would leave every running terminal ` +
        'unreachable. Roll back when no terminals are running, or deploy forward.'
    }
  }
  if (input.stateWritesSinceActivation === false) {
    return {
      safety: 'clean',
      target,
      notes: [
        'The pre-activation snapshot is intact, no terminals started since activation, and ' +
          'the store has not been written since. Restoring it changes nothing.'
      ]
    }
  }
  return {
    safety: 'lossy',
    target,
    discards: [
      input.stateWritesSinceActivation === null
        ? 'Any profile, settings and UI change written since activation — the store mtime ' +
          'could not be read, so assume there are some.'
        : `Every profile, settings and UI change written since ${
            input.record.activatedAt ?? 'activation'
          }, when ${input.record.active ?? 'the active version'} was activated.`
    ]
  }
}
