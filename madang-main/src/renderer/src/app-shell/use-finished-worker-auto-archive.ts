import { useEffect } from 'react'
import { useAppStore } from '../store'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import {
  DEFAULT_FINISHED_WORKER_ARCHIVE_MINUTES,
  finishedWorkerTabsToArchive
} from '../lib/finished-worker-auto-archive'

const CHECK_INTERVAL_MS = 60 * 1000

/** Closes finished, idle worker terminals; their transcripts stay in session history for resume. */
export function useFinishedWorkerAutoArchive(): void {
  const ready = useAppStore((s) => s.workspaceSessionReady)
  const minutes = useAppStore(
    (s) => s.settings?.finishedWorkerArchiveMinutes ?? DEFAULT_FINISHED_WORKER_ARCHIVE_MINUTES
  )

  useEffect(() => {
    if (!ready || minutes <= 0) {
      return
    }
    const timer = setInterval(() => {
      const tabIds = finishedWorkerTabsToArchive(
        useAppStore.getState(),
        Date.now(),
        minutes * 60 * 1000
      )
      for (const tabId of tabIds) {
        closeTerminalTab(tabId, {
          reason: 'cleanup',
          rejectPinned: true,
          skipRunningProcessConfirm: true,
          captureRecentlyClosed: false
        })
      }
    }, CHECK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [ready, minutes])
}
