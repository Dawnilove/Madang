import { useSyncExternalStore } from 'react'

/** The collaboration skill starts only when a session's first input begins with this marker. */
export const COLLABORATION_MARKER = '[협업] '

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
