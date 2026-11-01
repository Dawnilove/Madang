import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { madangUx } from '@/lib/madang-ux'
import { useContextualTour } from '../contextual-tours/use-contextual-tour'
import { requestContextualTourWhenReady } from '../contextual-tours/request-contextual-tour-when-ready'

/** Starts the intro tour again from Help; it ignores the "seen" record. */
export function startMadangIntroTour(): () => void {
  return requestContextualTourWhenReady({
    id: 'madang-intro',
    source: 'madang_intro_help',
    waitForActiveTourToClear: true
  })
}

/** Auto-starts the intro tour for first-run users and opens the side panels it points at. */
export function useMadangIntroTour(): void {
  useContextualTour('madang-intro', madangUx.madangShell, 'madang_intro_visible', {
    recordFeatureInteraction: false
  })
  const active = useAppStore((s) => s.activeContextualTourId === 'madang-intro')
  const setRightSidebarOpen = useAppStore((s) => s.setRightSidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  useEffect(() => {
    // Steps 3-7 point at the side panels; a closed panel would silently drop them.
    if (active) {
      setSidebarOpen(true)
      setRightSidebarOpen(true)
    }
  }, [active, setRightSidebarOpen, setSidebarOpen])
}
