import type {
  AiVaultSession,
  ClaudeDesktopSessionGroup
} from '../../../../shared/ai-vault-types'

import { desktopSyncGroupLabel } from './ai-vault-desktop-sync-plan'

type SessionGroup = { key: string; label: string | null; sessions: AiVaultSession[] }

/**
 * Regroups the sessions the user filed into groups in the Claude desktop sidebar under that group's name and order.
 * Desktop sessions the user left ungrouped go under their project folder, so a worktree session joins its project.
 * Both kinds list before sessions the desktop app does not know.
 */
export function regroupByDesktopGroup<Group extends SessionGroup>(
  groups: readonly Group[],
  groupBySessionId: ReadonlyMap<string, ClaudeDesktopSessionGroup>,
  originBySessionId: ReadonlyMap<string, string> = new Map()
): SessionGroup[] {
  if (groupBySessionId.size === 0 && originBySessionId.size === 0) {
    return [...groups]
  }
  const byOrigin = new Map<string, SessionGroup>()
  const named = new Map<string, { group: ClaudeDesktopSessionGroup; sessions: AiVaultSession[] }>()
  const rest: SessionGroup[] = []
  for (const group of groups) {
    const kept: AiVaultSession[] = []
    for (const session of group.sessions) {
      const desktopGroup = groupBySessionId.get(session.sessionId)
      const origin = originBySessionId.get(session.sessionId)
      if (!desktopGroup && origin) {
        const entry = byOrigin.get(origin) ?? {
          key: `desktop-origin:${origin}`,
          label: desktopSyncGroupLabel(origin),
          sessions: []
        }
        entry.sessions.push(session)
        byOrigin.set(origin, entry)
        continue
      }
      if (!desktopGroup) {
        kept.push(session)
        continue
      }
      const entry = named.get(desktopGroup.id) ?? { group: desktopGroup, sessions: [] }
      entry.sessions.push(session)
      named.set(desktopGroup.id, entry)
    }
    if (kept.length > 0) {
      rest.push({ ...group, sessions: kept })
    }
  }
  const namedGroups = [...named.values()]
    .sort((left, right) => left.group.rank - right.group.rank)
    .map(({ group, sessions }) => ({
      key: `desktop-group:${group.id}`,
      label: group.name,
      sessions: [...sessions].sort(
        (left, right) =>
          (groupBySessionId.get(left.sessionId)?.sessionRank ?? 0) -
          (groupBySessionId.get(right.sessionId)?.sessionRank ?? 0)
      )
    }))
  return [...namedGroups, ...byOrigin.values(), ...rest]
}
