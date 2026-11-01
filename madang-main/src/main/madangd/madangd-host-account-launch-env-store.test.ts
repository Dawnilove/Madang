import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readMadangdHostAccountLaunchEnv,
  writeMadangdHostAccountLaunchEnv
} from './madangd-host-account-launch-env-store'

const dirs: string[] = []
function userData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'madangd-host-accounts-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('madangd host account launch env store', () => {
  it('round-trips what the desktop pushed', () => {
    const dir = userData()
    const launchEnv = {
      wslDistro: 'Ubuntu',
      claude: { CLAUDE_CONFIG_DIR: '/home/u/.madang/claude/a' },
      terminal: { CODEX_HOME: '/home/u/.madang/codex/b' }
    }
    writeMadangdHostAccountLaunchEnv(dir, launchEnv)
    expect(readMadangdHostAccountLaunchEnv(dir)).toEqual(launchEnv)
  })

  it('reads nothing from a missing, corrupt or unsafe file', () => {
    const dir = userData()
    expect(readMadangdHostAccountLaunchEnv(dir)).toBeNull()
    writeFileSync(join(dir, 'host-account-launch-env.json'), '{not json')
    expect(readMadangdHostAccountLaunchEnv(dir)).toBeNull()
    writeFileSync(
      join(dir, 'host-account-launch-env.json'),
      JSON.stringify({ wslDistro: 'Ubuntu', claude: { PATH: '/evil' }, terminal: {} })
    )
    expect(readMadangdHostAccountLaunchEnv(dir)).toBeNull()
  })
})
