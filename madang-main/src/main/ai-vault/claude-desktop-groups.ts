import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClaudeDesktopSessionGroup } from '../../shared/ai-vault-types'

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 데스크톱 사이드바의 묶음(이름·순서·소속). 읽기 전용이다.
 * 위치: <root>\<package>\claude_desktop_config.json 의 preferences.epitaxyPrefs. 문서화되지 않은 비공식 형식이라
 * 못 읽으면 빈 결과를 돌려준다. 같은 파일에 다른 설정이 있어도 이 항목만 꺼내고 나머지는 쓰지 않는다.
 * 규칙: 이 파일에는 로그인 정보가 같이 있을 수 있다. 오류 객체·원본 문자열을 로그·토스트·IPC 응답에 넣지 않는다.
 */
export function parseDesktopGroups(raw: string): Map<string, ClaudeDesktopSessionGroup> {
  const result = new Map<string, ClaudeDesktopSessionGroup>()
  const config: unknown = JSON.parse(raw)
  const prefs = isRec(config) && isRec(config.preferences) ? config.preferences.epitaxyPrefs : null
  if (!isRec(prefs) || !isRec(prefs['dframe-group-scopes'])) {
    return result
  }
  const sectionsByScope = isRec(prefs['dframe-code-sections']) ? prefs['dframe-code-sections'] : {}
  for (const [account, scope] of Object.entries(prefs['dframe-group-scopes'])) {
    if (!isRec(scope) || !Array.isArray(scope.groups) || !isRec(scope.assignments)) {
      continue
    }
    const names = new Map(
      scope.groups.flatMap((group) =>
        isRec(group) && typeof group.id === 'string' && typeof group.name === 'string'
          ? [[group.id, group.name] as const]
          : []
      )
    )
    const accountSections = sectionsByScope[account]
    const sections =
      isRec(accountSections) && Array.isArray(accountSections.sections)
        ? accountSections.sections
        : []
    const rankById = new Map(
      sections.flatMap((section) =>
        isRec(section) && typeof section.id === 'string' && typeof section.order === 'number'
          ? [[section.id, section.order] as const]
          : []
      )
    )
    const order = isRec(scope.order) ? scope.order : {}
    for (const [sessionKey, groupId] of Object.entries(scope.assignments)) {
      const name = typeof groupId === 'string' ? names.get(groupId) : undefined
      if (!name || typeof groupId !== 'string') {
        continue
      }
      const members = Array.isArray(order[groupId]) ? order[groupId] : []
      const sessionRank = members.indexOf(sessionKey)
      result.set(sessionKey.replace(/^code:/, ''), {
        id: groupId,
        name,
        rank: rankById.get(groupId) ?? Number.MAX_SAFE_INTEGER,
        sessionRank: sessionRank !== -1 ? sessionRank : Number.MAX_SAFE_INTEGER
      })
    }
  }
  return result
}

export async function readDesktopGroups(
  root: string | null
): Promise<Map<string, ClaudeDesktopSessionGroup>> {
  const merged = new Map<string, ClaudeDesktopSessionGroup>()
  if (!root) {
    return merged
  }
  const packages = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of packages) {
    if (!entry.isDirectory()) {
      continue
    }
    try {
      const raw = await readFile(join(root, entry.name, 'claude_desktop_config.json'), 'utf8')
      for (const [key, group] of parseDesktopGroups(raw)) {
        merged.set(key, group)
      }
    } catch {
      // 파일이 없거나 형식이 다르면 묶음 없이 보여 준다.
    }
  }
  return merged
}
