import { decideWhatsNew, type ReleaseNotes } from '../../../../shared/whats-new'

export type WhatsNewToShow = { version: string; notes: ReleaseNotes }

/**
 * 시작 후 한 번 부른다. 창을 띄울 내용이 있으면 돌려주고, 없으면 null.
 * 새로 설치했으면 현재 버전만 기록한다. 본문을 못 가져오면 기록하지 않아 다음 실행에 다시 시도한다.
 */
export async function checkWhatsNew(
  lastSeen: string | undefined,
  recordVersion: (version: string) => void
): Promise<WhatsNewToShow | null> {
  try {
    const version = await window.api.updater.getVersion()
    const action = decideWhatsNew(lastSeen, version)
    if (action === 'record') {
      recordVersion(version)
    }
    if (action !== 'fetch') {
      return null
    }
    const notes = await window.api.updater.getReleaseNotes()
    return notes ? { version, notes } : null
  } catch {
    return null
  }
}
