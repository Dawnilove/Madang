import { useEffect } from 'react'
import { toggleTerminalDrawer } from '@/lib/terminal-drawer'

/** Ctrl+` opens, folds and unfolds the terminal drawer. Capture phase, so a focused terminal does not swallow it. */
export function useTerminalDrawerShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.code !== 'Backquote' ||
        !event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      toggleTerminalDrawer()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
