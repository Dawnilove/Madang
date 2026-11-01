import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { WhatsNewDialog } from './WhatsNewDialog'
import { checkWhatsNew, type WhatsNewToShow } from './whats-new-check'

/** 앱 시작 후 설정이 준비되면 한 번만 확인한다. 닫을 때 현재 버전을 기록한다. */
export function WhatsNewHost(): React.JSX.Element | null {
  const settingsReady = useAppStore((s) => s.settings !== null)
  const lastSeen = useAppStore((s) => s.settings?.lastSeenWhatsNewVersion)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [toShow, setToShow] = useState<WhatsNewToShow | null>(null)
  const checked = useRef(false)

  useEffect(() => {
    if (!settingsReady || checked.current) {
      return
    }
    checked.current = true
    void checkWhatsNew(
      lastSeen,
      (version) => void updateSettings({ lastSeenWhatsNewVersion: version })
    ).then(setToShow)
  }, [settingsReady, lastSeen, updateSettings])

  if (!toShow) {
    return null
  }
  return (
    <WhatsNewDialog
      version={toShow.version}
      notes={toShow.notes}
      onClose={() => {
        void updateSettings({ lastSeenWhatsNewVersion: toShow.version })
        setToShow(null)
      }}
    />
  )
}
