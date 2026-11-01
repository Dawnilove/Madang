import { describe, expect, it } from 'vitest'
import {
  desktopSyncGroupLabel,
  desktopSyncTarget,
  planDesktopSync
} from './ai-vault-desktop-sync-plan'

const session = (sessionId: string, title: string, cwd: string, originCwd = cwd) => ({
  sessionId,
  title,
  cwd,
  originCwd
})

describe('desktopSyncGroupLabel', () => {
  it('names a group by its folder, and scratch workspaces by Claude', () => {
    expect(desktopSyncGroupLabel('C:\\Users\\me\\Desktop\\CAPEK')).toBe('CAPEK')
    expect(desktopSyncGroupLabel('C:/x/Claude-Data/pkg/scratch-workspaces/a/b/scratch-1')).toBe(
      'Claude'
    )
  })
})

describe('planDesktopSync', () => {
  it('lists desktop groups first in desktop order, then origin folders, and counts open sessions', () => {
    const inGroup = (sessionId: string, id: string, rank: number, sessionRank: number) => ({
      ...session(sessionId, sessionId, 'C:\\w\\JetDeck'),
      group: { id, name: `Desk ${id}`, rank, sessionRank }
    })
    const plan = planDesktopSync({
      active: [
        session('loose', 'loose', 'C:\\w\\Madang\\.claude\\worktrees\\x', 'C:\\w\\Madang'),
        inGroup('b2', 'b', 1, 1),
        inGroup('a1', 'a', 0, 0),
        inGroup('b1', 'b', 1, 0),
        session('open', 'open', 'C:\\w\\CAPEK')
      ],
      isOpen: (sessionId) => sessionId === 'open'
    })
    expect(plan.existing).toBe(1)
    expect(plan.items.map((item) => item.session.sessionId)).toEqual(['a1', 'b1', 'b2', 'loose'])
    expect(plan.groups).toEqual([
      { key: 'desktop-group:a', label: 'Desk a' },
      { key: 'desktop-group:b', label: 'Desk b' },
      { key: 'C:/w/Madang', label: 'Madang' }
    ])
  })

  it('titles an untitled session by its folder', () => {
    const plan = planDesktopSync({
      active: [session('a', '', 'C:\\w\\CAPEK')],
      isOpen: () => false
    })
    expect(plan.items[0].session.title).toBe('CAPEK')
  })
})

describe('desktopSyncTarget', () => {
  const folderWorkspaces = [
    { id: 'f-old', folderPath: 'C:/w/Madang/.claude/worktrees/x', isArchived: true },
    { id: 'f1', folderPath: 'C:/w/Madang/.claude/worktrees/y' }
  ]
  const worktrees = [{ id: 'repo::C:/w/Madang', path: 'C:/w/Madang' }]

  it('opens in the project row whose folder is the session folder, ignoring case and slashes', () => {
    expect(
      desktopSyncTarget({
        cwd: 'c:\\w\\madang',
        worktrees,
        folders: folderWorkspaces
      })
    ).toEqual({
      worktreeId: 'repo::C:/w/Madang'
    })
  })

  it('reuses a folder workspace for the same folder, else asks for one; never a nearby project', () => {
    expect(
      desktopSyncTarget({
        cwd: 'C:\\w\\Madang\\.claude\\worktrees\\y',
        worktrees,
        folders: folderWorkspaces
      })
    ).toEqual({ worktreeId: 'folder:f1' })
    // An archived folder workspace does not count.
    expect(
      desktopSyncTarget({
        cwd: 'C:\\w\\Madang\\.claude\\worktrees\\x',
        worktrees,
        folders: folderWorkspaces
      })
    ).toEqual({ folderPath: 'C:/w/Madang/.claude/worktrees/x' })
  })
})
