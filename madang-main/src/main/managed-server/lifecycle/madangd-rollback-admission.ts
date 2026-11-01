import type { MadangdTerminalCensus } from '../../../shared/madangd-terminal-census'
import type { MadangdRollbackResult } from '../install/madangd-remote-rollback'

export function rollbackRecountRefusal(census: MadangdTerminalCensus): MadangdRollbackResult | null {
  const live = census.liveSessions
  if (live === 0) {
    return null
  }
  return {
    outcome: 'refused',
    code: live === null ? 'madangd_rollback_census_unavailable' : 'madangd_rollback_terminals_running',
    reason:
      live === null
        ? 'The server did not answer how many terminals it runs. Retry when it answers.'
        : 'A terminal opened on this server before it could be stopped; close it, then retry.'
  }
}

export const ROLLBACK_STALE_COUNT: MadangdRollbackResult = {
  outcome: 'refused',
  code: 'madangd_rollback_census_unavailable',
  reason: 'The terminal count went stale before the server could be stopped. Retry the rollback.'
}
