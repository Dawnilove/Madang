import type { AiVaultSession } from '../../../../shared/ai-vault-types'

type SessionGroup = { sessions: AiVaultSession[] }

/**
 * Puts each fork right under its parent session in the same group and marks it with an arrow,
 * like the Claude desktop sidebar. A fork whose parent is in another group stays where it is.
 * A session the desktop app names takes that name, so the list reads like its sidebar.
 */
export function nestForkSessions<Group extends SessionGroup>(
  groupsIn: readonly Group[],
  parentByChild: ReadonlyMap<string, string>,
  titleBySessionId: ReadonlyMap<string, string> = new Map()
): Group[] {
  if (parentByChild.size === 0 && titleBySessionId.size === 0) {
    return [...groupsIn]
  }
  const groups = groupsIn.map((group) => {
    // The same conversation can be listed twice (its transcript and a Madang chat copy); keep the first, newest row.
    const seen = new Set<string>()
    const sessions = group.sessions.flatMap((session) => {
      const title = titleBySessionId.get(session.sessionId)
      if (!title) {
        return [session]
      }
      if (seen.has(session.sessionId)) {
        return []
      }
      seen.add(session.sessionId)
      return [{ ...session, title }]
    })
    return { ...group, sessions }
  })
  return groups.map((group) => {
    const present = new Set(group.sessions.map((session) => session.sessionId))
    const forksByParent = new Map<string, AiVaultSession[]>()
    const roots: AiVaultSession[] = []
    for (const session of group.sessions) {
      const parent = parentByChild.get(session.sessionId)
      if (parent && present.has(parent)) {
        forksByParent.set(parent, [...(forksByParent.get(parent) ?? []), session])
      } else {
        roots.push(session)
      }
    }
    if (forksByParent.size === 0) {
      return group
    }
    const sessions = roots.flatMap((root) => [
      root,
      ...(forksByParent.get(root.sessionId) ?? []).map((fork) => ({
        ...fork,
        title: `↳ ${fork.title}`
      }))
    ])
    return { ...group, sessions }
  })
}
