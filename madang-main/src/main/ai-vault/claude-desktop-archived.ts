import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readDesktopGroups } from './claude-desktop-groups'
import type {
  ClaudeDesktopActiveSession,
  ClaudeDesktopSessionGroup,
  ClaudeDesktopSessionIds
} from '../../shared/ai-vault-types'

// 폴더 구조: <root>\<package>\claude-code-sessions\<account>\<org>\local_*.json (Windows MSIX)
const SESSIONS_DIR = 'claude-code-sessions'
const SESSION_FILE = /^local_.*\.json$/

export function defaultClaudeDesktopDataRoot(): string | null {
  const localAppData = process.env.LOCALAPPDATA
  return localAppData ? join(localAppData, 'Claude-Data') : null
}

async function sessionFiles(dir: string, depth: number): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (depth === 0) {
        return entry.isFile() && SESSION_FILE.test(entry.name) ? [path] : []
      }
      // depth 3 = <package> 폴더 안. 세션 폴더만 내려간다.
      if (!entry.isDirectory() || (depth === 3 && entry.name !== SESSIONS_DIR)) {
        return []
      }
      return sessionFiles(path, depth - 1)
    })
  )
  return nested.flat()
}

type ActiveWithDesktopId = ClaudeDesktopActiveSession & { desktopId?: string; spawnedFrom?: string }
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
type FileIds = Omit<ClaudeDesktopSessionIds, 'active'> & { active?: ActiveWithDesktopId[] }

// 다른 세션에서 띄운 세션은 시작 폴더가 Claude Code 워크트리로 적히기도 한다. 원래 프로젝트로 묶어야 목록이 쪼개지지 않는다.
export const worktreeProject = (path: string): string =>
  path.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+[\\/]?$/, '')

function cliIds(raw: string): FileIds {
  const record: unknown = JSON.parse(raw)
  if (typeof record !== 'object' || record === null) {
    return { archived: [], known: [] }
  }
  const {
    isArchived,
    cliSessionId,
    priorCliSessionIds,
    cwd,
    title,
    originCwd,
    btwLoweredFrom,
    sessionId,
    forkedFromSessionId,
    spawnedFrom,
    scheduledTaskId,
    lastActivityAt
  } = record as Record<string, unknown>
  // 이어하기 전 CLI 세션도 Orca에는 따로 보이므로 보관 때는 함께 숨긴다.
  const ids = [
    cliSessionId,
    ...(Array.isArray(priorCliSessionIds) ? priorCliSessionIds : [])
  ].filter((id): id is string => typeof id === 'string' && id !== '')
  // known에는 현재 ID만 넣는다. 이전 ID까지 넣으면 활성 세션의 옛 기록이 "데스크톱 세션"으로 남는다.
  // btw는 본 대화 곁의 사이드 채팅이라 데스크톱 사이드바에 따로 나오지 않는다. known에서도 빼서 목록에 중복 줄로 뜨지 않게 한다.
  // btwLoweredFrom은 effort를 낮춘 btw에만 있다. 낮출 게 없던 btw는 spawnedFrom.btw로 알아본다.
  // 예약 작업 실행 기록(scheduledTaskId)은 데스크톱 세션 목록에 나오지 않는다.
  const hidden =
    btwLoweredFrom !== undefined ||
    scheduledTaskId !== undefined ||
    (isObject(spawnedFrom) && spawnedFrom.btw === true)
  const known =
    !hidden && typeof cliSessionId === 'string' && cliSessionId !== '' ? [cliSessionId] : []
  const cwds = known.length > 0 && typeof cwd === 'string' && cwd !== '' ? { [known[0]]: cwd } : {}
  const active =
    isArchived !== true && known.length > 0 && typeof cwd === 'string' && cwd !== ''
      ? [
          {
            sessionId: known[0],
            title: typeof title === 'string' ? title : '',
            cwd,
            originCwd: worktreeProject(
              typeof originCwd === 'string' && originCwd !== '' ? originCwd : cwd
            ),
            lastActivityAt: typeof lastActivityAt === 'number' ? lastActivityAt : undefined,
            // 데스크톱 ID로 적힌 값이다. 합친 뒤 CLI ID로 바꾼다.
            desktopId: typeof sessionId === 'string' ? sessionId : undefined,
            forkedFrom: typeof forkedFromSessionId === 'string' ? forkedFromSessionId : undefined,
            spawnedFrom:
              isObject(spawnedFrom) && typeof spawnedFrom.sessionId === 'string'
                ? spawnedFrom.sessionId
                : undefined
          }
        ]
      : []
  return { archived: isArchived === true ? ids : [], known, cwds, active }
}

/**
 * Claude 데스크톱 앱의 세션 ID (= Orca Claude 세션의 sessionId). 읽기 전용.
 * 폴더가 없거나 파일 형식이 달라도 던지지 않고 읽은 만큼만 돌려준다.
 */
export async function readClaudeDesktopSessionIds(
  root: string | null = defaultClaudeDesktopDataRoot()
): Promise<ClaudeDesktopSessionIds> {
  if (!root) {
    return { archived: [], known: [], cwds: {}, active: [] }
  }
  const files = await sessionFiles(root, 4)
  const perFile = await Promise.all(
    files.map((file) =>
      readFile(file, 'utf8')
        .then(cliIds)
        .catch(() => ({ archived: [], known: [] }) as FileIds)
    )
  )
  const groups = await readDesktopGroups(root)
  return {
    archived: [...new Set(perFile.flatMap((ids) => ids.archived))],
    known: [...new Set(perFile.flatMap((ids) => ids.known))],
    cwds: Object.assign({}, ...perFile.map((ids) => ids.cwds)),
    active: resolveForks(
      perFile.flatMap((ids) => ids.active ?? []),
      groups
    )
  }
}

/**
 * 부모는 데스크톱 ID로 적혀 있다. 부모가 활성 목록에 있을 때만 CLI ID로 바꾼다.
 * 다른 세션에서 갈라져 나온(spawnedFrom) 세션이 먼저, 그다음 fork가 부모를 정한다.
 * 묶음이 없는 세션은 부모의 묶음을 따른다.
 */
function resolveForks(
  active: readonly ActiveWithDesktopId[],
  groups: ReadonlyMap<string, ClaudeDesktopSessionGroup>
): ClaudeDesktopActiveSession[] {
  const byDesktopId = new Map(
    active.flatMap((session) => (session.desktopId ? [[session.desktopId, session] as const] : []))
  )
  return active.map(({ desktopId, forkedFrom, spawnedFrom, ...session }) => {
    const parentDesktopId = [spawnedFrom, forkedFrom].find(
      (id): id is string => id !== undefined && byDesktopId.has(id)
    )
    const parent = parentDesktopId ? byDesktopId.get(parentDesktopId) : undefined
    const group =
      (desktopId ? groups.get(desktopId) : undefined) ??
      (parent?.desktopId ? groups.get(parent.desktopId) : undefined)
    return {
      ...session,
      ...(parent ? { forkedFrom: parent.sessionId } : {}),
      ...(group ? { group } : {})
    }
  })
}
