import { useSyncExternalStore } from 'react'

/** The collaboration skill starts only when a session's first input begins with this marker. */
export const COLLABORATION_MARKER = '[협업] '

/** Sent after the user's text, so the rules reach the agent even when the skill is not installed (the CLI serves them without it). Agent-facing, not UI text. */
export const COLLABORATION_RULES_HINT =
  '\n\n(Madang 협업 규칙: 먼저 `madang skills get collaboration` 명령을 실행한다. 출력된 규칙을 따라 총괄 세션으로 일한다.)'

const STORAGE_KEY = 'madang.collaborationTabs'
const listeners = new Set<() => void>()

function load(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

let tabIds = load()

/** shortcut: kept per app install in localStorage, so it does not follow a session to another device; move it into the tab model if that is needed. */
export function markCollaborationTab(tabId: string): void {
  if (tabIds.has(tabId)) {
    return
  }
  tabIds = new Set(tabIds).add(tabId)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...tabIds]))
  } catch {
    // Storage refused: the badge lasts until the app restarts.
  }
  listeners.forEach((listener) => listener())
}

export function useIsCollaborationTab(tabId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => tabIds.has(tabId),
    () => false
  )
}
