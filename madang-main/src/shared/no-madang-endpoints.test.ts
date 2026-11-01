import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Madang must not contact Orca servers or link to Orca channels. Test and fixture files may mention them.
const HOSTS = String.raw`onorca\.dev|(^|[^a-z.])orca\.dev([^a-z]|$)|orca_build|discord\.gg/fzjDKHxv8Q|apps\.apple\.com/app/orca`
const SRC_ROOT = join(__dirname, '..')

describe('no Orca endpoints in product source', () => {
  it('has no Orca hosts or channels outside tests', () => {
    let hits = ''
    try {
      hits = execFileSync(
        'git',
        [
          'grep',
          '-lE',
          HOSTS,
          '--',
          '.',
          ':!*.test.*',
          ':!*.spec.*',
          ':!*fixture*',
          ':!*__mocks__*',
          ':!*__fixtures__*',
          // The places that name Orca on purpose: the opt-in Orca-compatible plugin index and skill share link.
          ':!shared/plugins/orca-compat.ts',
          ':!shared/skills/orca-compat-skill-share.ts'
        ],
        { cwd: SRC_ROOT, encoding: 'utf8' }
      )
    } catch (error) {
      // git grep exits 1 when nothing matches.
      if ((error as { status?: number }).status !== 1) {
        throw error
      }
    }
    expect(hits.split('\n').filter(Boolean)).toEqual([])
  })
}, 60_000)
