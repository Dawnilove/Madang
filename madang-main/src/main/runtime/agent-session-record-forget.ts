import {
  agentSessionLeaseIsReleased,
  agentSessionLeaseOwnerVerdict
} from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionStoreState } from './agent-session-store-state'

/** Drops a chat whose owner provably exited, or that no process ever ran (opened, never sent to). */
export function forgetExitedAgentSessionRecord(
  draft: AgentSessionStoreState,
  sessionId: string
): boolean {
  const record = draft.records.get(sessionId)
  if (!record) {
    return false
  }
  const { lease } = record
  const neverRan =
    agentSessionLeaseIsReleased(lease) &&
    lease.ownerProcess === null &&
    lease.reservedSpawnToken === null &&
    lease.provenHandleLinkId === null
  if (agentSessionLeaseOwnerVerdict(lease) !== 'exited' && !neverRan) {
    return false
  }
  draft.records.delete(sessionId)
  return true
}
