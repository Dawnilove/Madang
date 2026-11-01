import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDesktopGroups, readDesktopGroups } from './claude-desktop-groups'

// 가짜 값이다. 실제 토큰을 넣지 않는다.
const FAKE_SECRET = 'FAKE-SECRET-VALUE-0000'

const config = {
  oauthAccount: { token: FAKE_SECRET },
  preferences: {
    epitaxyPrefs: {
      'dframe-group-scopes': {
        acct: {
          groups: [{ id: 'g1', name: 'Robots', secret: FAKE_SECRET }],
          assignments: { 'code:s1': 'g1' },
          order: { g1: ['code:s1'] }
        }
      },
      'dframe-code-sections': { acct: { sections: [{ id: 'g1', order: 2 }] } }
    }
  }
}

let root: string | null = null
afterEach(async () => {
  vi.restoreAllMocks()
  if (root) {
    await rm(root, { recursive: true, force: true })
    root = null
  }
})

describe('parseDesktopGroups', () => {
  it('returns only group names and ranks, never other settings', () => {
    const groups = parseDesktopGroups(JSON.stringify(config))
    expect([...groups]).toEqual([['s1', { id: 'g1', name: 'Robots', rank: 2, sessionRank: 0 }]])
    expect(JSON.stringify([...groups])).not.toContain(FAKE_SECRET)
  })
})

describe('readDesktopGroups', () => {
  it('returns nothing and prints nothing when the file does not parse', async () => {
    root = await mkdtemp(join(tmpdir(), 'madang-desktop-groups-'))
    await mkdir(join(root, 'pkg'))
    await writeFile(join(root, 'pkg', 'claude_desktop_config.json'), `{"token":"${FAKE_SECRET}"`)
    const printed = vi.fn()
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(printed)
    }
    const groups = await readDesktopGroups(root)
    expect(groups.size).toBe(0)
    expect(printed).not.toHaveBeenCalled()
  })
})
