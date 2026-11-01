import { isOrcaSessionId, type OrcaSessionId } from './madang-session-address'

/** A literal Orca session id for a test, checked by the same predicate production uses. */
export function testOrcaSessionId(id: string): OrcaSessionId {
  if (!isOrcaSessionId(id)) {
    throw new Error(`Not a Madang session id: ${id}`)
  }
  return id
}
