import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readClaudeDesktopSessionIds, worktreeProject } from './claude-desktop-archived'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<{ root: string; orgDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-claude-desktop-archived-'))
  tempRoots.push(root)
  const orgDir = join(root, 'claude_pkg', 'claude-code-sessions', 'account', 'org')
  await mkdir(orgDir, { recursive: true })
  return { root, orgDir }
}

describe('readClaudeDesktopSessionIds', () => {
  it('returns only archived CLI ids (with prior ids), skips active, broken, and non-session files', async () => {
    const { root, orgDir } = await makeRoot()
    await writeFile(
      join(orgDir, 'local_a.json'),
      JSON.stringify({ cliSessionId: 'cli-a', isArchived: true, priorCliSessionIds: ['cli-a0'] })
    )
    await writeFile(join(orgDir, 'local_b.json'), JSON.stringify({ cliSessionId: 'cli-b' }))
    await writeFile(
      join(orgDir, 'local_c.json'),
      JSON.stringify({
        cliSessionId: 'cli-c',
        isArchived: false,
        priorCliSessionIds: ['cli-c0'],
        cwd: 'C:\\Users\\me\\work'
      })
    )
    await writeFile(
      join(orgDir, 'local_btw.json'),
      JSON.stringify({ cliSessionId: 'cli-btw', btwLoweredFrom: 'x', cwd: 'C:\\Users\\me\\work' })
    )
    // effort를 낮추지 않은 btw(btwLoweredFrom 없음)와 예약 작업 실행 기록도 뺀다.
    await writeFile(
      join(orgDir, 'local_btw2.json'),
      JSON.stringify({
        cliSessionId: 'cli-btw2',
        spawnedFrom: { sessionId: 'local_x', btw: true },
        cwd: 'C:\\Users\\me\\work'
      })
    )
    await writeFile(
      join(orgDir, 'local_sched.json'),
      JSON.stringify({
        cliSessionId: 'cli-sched',
        scheduledTaskId: 'e2e-after-analysis',
        cwd: 'C:\\Users\\me\\work'
      })
    )
    await writeFile(join(orgDir, 'local_broken.json'), '{ not json')
    await writeFile(join(orgDir, 'local_null.json'), 'null')
    await writeFile(join(orgDir, 'archived-sessions.idx'), '{"v":1}')
    // 세션 폴더 밖의 파일은 읽지 않는다.
    await writeFile(
      join(root, 'claude_pkg', 'local_outside.json'),
      JSON.stringify({ cliSessionId: 'cli-outside', isArchived: true })
    )

    const ids = await readClaudeDesktopSessionIds(root)
    expect(ids.archived.sort()).toEqual(['cli-a', 'cli-a0'])
    // known은 활성·보관 세션의 현재 ID만 담는다. 이전 ID(cli-a0, cli-c0), btw 사이드 채팅, 세션 폴더 밖 파일은 뺀다.
    expect(ids.known.sort()).toEqual(['cli-a', 'cli-b', 'cli-c'])
    // cwd는 현재 ID에만 붙는다. cwd가 없는 세션은 항목이 없다.
    expect(ids.cwds).toEqual({ 'cli-c': 'C:\\Users\\me\\work' })
    // 활성 목록은 보관되지 않은 일반 세션만 담는다(btw 사이드 채팅은 뺀다). 시작 폴더가 없으면 cwd를 쓴다.
    expect(ids.active).toEqual([
      {
        sessionId: 'cli-c',
        title: '',
        cwd: 'C:\\Users\\me\\work',
        originCwd: 'C:\\Users\\me\\work'
      }
    ])
  })

  it('returns an empty list when the folder is missing or unset', async () => {
    const { root } = await makeRoot()
    const none = { archived: [], known: [], cwds: {}, active: [] }
    expect(await readClaudeDesktopSessionIds(join(root, 'missing'))).toEqual(none)
    expect(await readClaudeDesktopSessionIds(null)).toEqual(none)
  })
})

describe('worktreeProject', () => {
  it('maps a Claude Code worktree folder to its project, and leaves other folders alone', () => {
    expect(worktreeProject('C:\\w\\Madang\\.claude\\worktrees\\fix-1')).toBe('C:\\w\\Madang')
    expect(worktreeProject('/home/me/app/.claude/worktrees/fix-1/')).toBe('/home/me/app')
    expect(worktreeProject('C:\\w\\Madang')).toBe('C:\\w\\Madang')
    expect(worktreeProject('C:\\w\\Madang\\.claude\\worktrees\\fix-1\\src')).toBe(
      'C:\\w\\Madang\\.claude\\worktrees\\fix-1\\src'
    )
  })
})
