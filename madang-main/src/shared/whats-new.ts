import { isValidAppVersion } from './app-version'

/** 설정에 저장하는 값. 없으면 아직 기록한 적이 없다. */
export type WhatsNewSettings = {
  /** 마지막으로 "새로운 점" 창을 닫은(또는 새로 설치해 기록한) 앱 버전 */
  lastSeenWhatsNewVersion?: string
}

/** GitHub 릴리스 본문 원문. 요약하지 않는다. */
export type ReleaseNotes = {
  title: string
  body: string
  url: string
}

/**
 * 시작 후 "새로운 점" 창을 어떻게 할지 정한다.
 * - none: 아무것도 하지 않는다 (같은 버전, 또는 버전 값이 올바르지 않음 — 웹 클라이언트 등)
 * - record: 새로 설치한 경우. 창 없이 현재 버전만 기록한다
 * - fetch: 버전이 달라졌다. 릴리스 본문을 가져와 보여 준다
 */
export type WhatsNewAction = 'none' | 'record' | 'fetch'

export function decideWhatsNew(lastSeen: string | undefined, current: string): WhatsNewAction {
  if (!isValidAppVersion(current)) {
    return 'none'
  }
  if (!lastSeen) {
    return 'record'
  }
  return lastSeen === current ? 'none' : 'fetch'
}
