import type { ClaudeDesktopActiveSession } from '../../../../shared/ai-vault-types'

/**
 * 열린 Chat 중 데스크톱에서 새 활동이 생긴 세션의 ID를 돌려주고, 본 시각을 `seen`에 적는다.
 * 처음 보는 세션은 기준만 적고 알리지 않는다. shortcut: 기준은 메모리에만 있어 앱을 다시 켜면 처음 본 값부터 센다.
 */
export function takeNewDesktopActivity(
  active: readonly ClaudeDesktopActiveSession[],
  seen: Map<string, number>,
  hasLiveChat: (sessionId: string) => boolean
): string[] {
  const changed: string[] = []
  for (const entry of active) {
    if (entry.lastActivityAt === undefined || !hasLiveChat(entry.sessionId)) {
      continue
    }
    const before = seen.get(entry.sessionId)
    seen.set(entry.sessionId, entry.lastActivityAt)
    if (before !== undefined && entry.lastActivityAt > before) {
      changed.push(entry.sessionId)
    }
  }
  return changed
}
