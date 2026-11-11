import { useCallback, useSyncExternalStore } from 'react'

/** Reply quotes and `!command` output wait above the input as compact cards and are sent before the typed text. */
export type NativeChatContextBlock = {
  id: string
  kind: 'reply' | 'quote' | 'command'
  /** Short title shown on the card, e.g. the command line. */
  label: string
  /** Exact text sent to the agent, already formatted (quote or fenced block). */
  text: string
}

const EMPTY: readonly NativeChatContextBlock[] = Object.freeze([])
// shortcut: memory only, so cards survive tab switches but not an app restart; move into the draft store if that is needed.
const blocksByScope = new Map<string, readonly NativeChatContextBlock[]>()
const listeners = new Map<string, Set<() => void>>()
let nextId = 0

function emit(scope: string): void {
  listeners.get(scope)?.forEach((listener) => listener())
}

export function readNativeChatContextBlocks(scope: string): readonly NativeChatContextBlock[] {
  return blocksByScope.get(scope) ?? EMPTY
}

export function addNativeChatContextBlock(
  scope: string,
  block: Omit<NativeChatContextBlock, 'id'>
): void {
  nextId += 1
  blocksByScope.set(scope, [...readNativeChatContextBlocks(scope), { ...block, id: `ctx-${nextId}` }])
  emit(scope)
}

export function removeNativeChatContextBlock(scope: string, id: string): void {
  const next = readNativeChatContextBlocks(scope).filter((block) => block.id !== id)
  if (next.length === 0) {
    blocksByScope.delete(scope)
  } else {
    blocksByScope.set(scope, next)
  }
  emit(scope)
}

export function clearNativeChatContextBlocks(scope: string): void {
  if (blocksByScope.delete(scope)) {
    emit(scope)
  }
}

/** The cards' text in order, ready to go in front of the typed message; empty when there are none. */
export function nativeChatContextText(scope: string): string {
  return readNativeChatContextBlocks(scope)
    .map((block) => (block.text.endsWith('\n\n') ? block.text : `${block.text.trimEnd()}\n\n`))
    .join('')
}

export function useNativeChatContextBlocks(scope: string): readonly NativeChatContextBlock[] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(scope) ?? new Set()
      set.add(listener)
      listeners.set(scope, set)
      return () => {
        set.delete(listener)
      }
    },
    [scope]
  )
  return useSyncExternalStore(subscribe, () => readNativeChatContextBlocks(scope))
}
