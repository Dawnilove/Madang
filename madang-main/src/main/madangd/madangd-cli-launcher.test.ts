import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '@orca/process-host'
import {
  MADANGD_CLI_ENTRY_FILENAME,
  MADANGD_WINDOWS_CLI_LAUNCHER_FILENAME
} from '../../shared/madangd-artifacts'
import {
  MADANGD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME,
  getMadangdCliLauncherPath,
  prepareMadangdCliLauncher
} from './madangd-cli-launcher'

const roots = vi.hoisted(() => ({ install: '', profile: '' }))
vi.mock('./madangd-app-paths', () => ({
  resolveMadangdInstallRoot: () => roots.install,
  resolveUserDataPath: () => roots.profile
}))

let directory = ''
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-node-cli-'))
  roots.install = join(directory, "server ' slot")
  roots.profile = join(directory, "profile ' data")
})

afterEach(async () => {
  Object.defineProperty(process, 'platform', platformDescriptor)
  await rm(directory, { recursive: true, force: true })
})

async function writeCli(): Promise<void> {
  const path = join(roots.install, ...MADANGD_CLI_ENTRY_FILENAME.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    'console.log(JSON.stringify({profile:process.env.MADANG_USER_DATA_PATH, args:process.argv.slice(2), electron:process.env.ELECTRON_RUN_AS_NODE}))'
  )
}

describe('madangd profile CLI launcher', () => {
  it.skipIf(process.platform === 'win32')(
    'launches pinned Node with intact arguments and the execution host profile',
    async () => {
      await writeCli()
      await prepareMadangdCliLauncher()
      const launcher = getMadangdCliLauncherPath()
      expect(launcher).toBe(join(roots.profile, 'cli', 'bin', 'madang'))
      if (!launcher) {
        throw new Error('CLI launcher is missing')
      }
      const args = ['orchestration', 'send', 'a body\nwith "quotes" and $HOME']
      const result = await runProcess({
        program: launcher,
        args,
        env: {
          ...process.env,
          MADANG_USER_DATA_PATH: '/another/owner',
          ELECTRON_RUN_AS_NODE: '1',
          NODE_OPTIONS: '--require /missing/inherited/preload'
        },
        timeoutMs: 5000
      })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ profile: roots.profile, args })
    }
  )

  it.skipIf(process.platform === 'win32')(
    "passes a person's own Madang settings through, adding only the profile",
    async () => {
      const path = join(roots.install, ...MADANGD_CLI_ENTRY_FILENAME.split('/'))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(
        path,
        "console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('ORCA_')))))"
      )
      await prepareMadangdCliLauncher()
      const result = await runProcess({
        program: getMadangdCliLauncherPath()!,
        args: ['status'],
        env: {
          PATH: process.env.PATH,
          MADANG_ENVIRONMENT: 'other-server',
          MADANG_PAIRING_CODE: 'other-pairing'
        },
        timeoutMs: 5000
      })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        MADANG_USER_DATA_PATH: roots.profile,
        MADANG_ENVIRONMENT: 'other-server',
        MADANG_PAIRING_CODE: 'other-pairing'
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refreshes the launcher when the host switches server slots',
    async () => {
      await writeCli()
      await prepareMadangdCliLauncher()
      roots.install = join(directory, 'updated server')
      await writeCli()
      await prepareMadangdCliLauncher()
      const launcher = getMadangdCliLauncherPath()
      if (!launcher) {
        throw new Error('CLI launcher is missing')
      }
      expect(await readFile(launcher, 'utf8')).toContain(roots.install)
    }
  )

  it('leaves old slots without a CLI usable and clears a previous launcher', async () => {
    await writeCli()
    await prepareMadangdCliLauncher()
    roots.install = join(directory, 'old server')
    await prepareMadangdCliLauncher()
    expect(getMadangdCliLauncherPath()).toBeNull()
  })

  describe('on a Windows host', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    })

    async function writeLauncher(contents: string): Promise<void> {
      const path = join(roots.install, ...MADANGD_WINDOWS_CLI_LAUNCHER_FILENAME.split('/'))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, contents)
    }

    const binDir = (): string => join(roots.profile, 'cli', 'bin')
    const readConfig = (): Promise<string> =>
      readFile(join(binDir(), MADANGD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME), 'utf8')

    it('installs the native launcher and points it at this slot, runtime and profile', async () => {
      await writeCli()
      await writeLauncher('native launcher v1')
      await prepareMadangdCliLauncher()
      const launcher = getMadangdCliLauncherPath()
      expect(launcher).toBe(join(binDir(), 'madang.exe'))
      expect(await readFile(launcher!, 'utf8')).toBe('native launcher v1')
      expect(await readConfig()).toBe(
        [
          `node=${process.execPath}`,
          `cli=${join(roots.install, ...MADANGD_CLI_ENTRY_FILENAME.split('/'))}`,
          `user-data=${roots.profile}`,
          ''
        ].join('\n')
      )
      // Batch/PowerShell proxies can reparse cmd.exe arguments instead of preserving them.
      expect((await readdir(binDir())).sort()).toEqual(
        [MADANGD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME, 'madang.exe'].sort()
      )
    })

    it('refreshes the launcher and its target when the host switches server slots', async () => {
      await writeCli()
      await writeLauncher('native launcher v1')
      await prepareMadangdCliLauncher()
      roots.install = join(directory, 'updated server')
      await writeCli()
      await writeLauncher('native launcher v2')
      await prepareMadangdCliLauncher()
      expect(await readFile(join(binDir(), 'madang.exe'), 'utf8')).toBe('native launcher v2')
      expect(await readConfig()).toContain(`cli=${join(roots.install, 'out', 'cli', 'index.js')}`)
    })

    it('leaves a slot without the native launcher with no madang command', async () => {
      await writeCli()
      await prepareMadangdCliLauncher()
      expect(getMadangdCliLauncherPath()).toBeNull()
    })
  })
})
