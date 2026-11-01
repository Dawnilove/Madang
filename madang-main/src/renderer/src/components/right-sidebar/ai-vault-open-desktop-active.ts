import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { AiVaultSessionResumeState } from './ai-vault-session-resume'

export const DESKTOP_ACTIVE_OPEN_LIMIT = 10

export type DesktopActiveOpenCandidate = {
  session: AiVaultSession
  resume: Pick<AiVaultSessionResumeState, 'blocked' | 'usesSessionWorktree'>
  /** A tab for this session is already open. */
  isOpen: boolean
}

export type DesktopActiveOpenSelection = {
  toOpen: AiVaultSession[]
  alreadyOpen: AiVaultSession[]
  /** The session folder is not an open project, or resuming it is blocked. */
  skippedNoProject: AiVaultSession[]
  /** Openable, but beyond the per-click limit. */
  remaining: AiVaultSession[]
}

/**
 * Picks which Claude desktop sessions a single click opens. A session whose folder is not an open
 * project is never opened: resuming it would land its tab in whatever workspace is active.
 */
export function selectDesktopActiveSessionsToOpen(args: {
  candidates: readonly DesktopActiveOpenCandidate[]
  /** Claude desktop ids that are known and not archived. */
  activeIds: ReadonlySet<string>
  limit?: number
}): DesktopActiveOpenSelection {
  const limit = args.limit ?? DESKTOP_ACTIVE_OPEN_LIMIT
  const result: DesktopActiveOpenSelection = {
    toOpen: [],
    alreadyOpen: [],
    skippedNoProject: [],
    remaining: []
  }
  const seen = new Set<string>()
  for (const { session, resume, isOpen } of args.candidates) {
    if (session.agent !== 'claude' || !args.activeIds.has(session.sessionId)) {
      continue
    }
    if (seen.has(session.sessionId)) {
      continue
    }
    seen.add(session.sessionId)
    if (isOpen) {
      result.alreadyOpen.push(session)
    } else if (resume.blocked || !resume.usesSessionWorktree) {
      result.skippedNoProject.push(session)
    } else if (result.toOpen.length < limit) {
      result.toOpen.push(session)
    } else {
      result.remaining.push(session)
    }
  }
  return result
}

/** Active = known to the desktop app and not archived. */
export function desktopActiveIds(
  known: ReadonlySet<string>,
  archived: ReadonlySet<string>
): Set<string> {
  return new Set([...known].filter((id) => !archived.has(id)))
}
