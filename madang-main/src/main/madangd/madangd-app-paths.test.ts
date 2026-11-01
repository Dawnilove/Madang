import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppPathName } from '../../shared/app-environment'
import { resolveMadangdInstallRoot, resolveMadangdPath, resolveUserDataPath } from './madangd-app-paths'

const ALL_PATH_NAMES: AppPathName[] = [
  'userData',
  'home',
  'appData',
  'temp',
  'downloads',
  'logs',
  'exe'
]

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
})

describe('resolveUserDataPath', () => {
  it('prefers MADANG_USER_DATA, then XDG_DATA_HOME, then ~/.madang', () => {
    vi.stubEnv('MADANG_USER_DATA', join(sep, 'srv', 'orca-state'))
    vi.stubEnv('XDG_DATA_HOME', join(sep, 'xdg'))
    expect(resolveUserDataPath()).toBe(join(sep, 'srv', 'orca-state'))

    vi.stubEnv('MADANG_USER_DATA', '')
    expect(resolveUserDataPath()).toBe(join(sep, 'xdg', 'Madang'))

    vi.stubEnv('XDG_DATA_HOME', '')
    expect(resolveUserDataPath()).toBe(join(homedir(), '.madang'))
  })
})

describe('resolveMadangdPath', () => {
  it('answers every path name without ever falling back to the data directory', () => {
    vi.stubEnv('MADANG_USER_DATA', join(sep, 'srv', 'orca-state'))
    const answers = new Map(ALL_PATH_NAMES.map((name) => [name, resolveMadangdPath(name)]))

    for (const [name, answer] of answers) {
      expect(answer, `${name} answered nothing`).toBeTruthy()
      if (name !== 'userData') {
        expect(answer, `${name} answered the userData directory`).not.toBe(
          join(sep, 'srv', 'orca-state')
        )
      }
    }
  })

  it("answers 'exe' with the Node binary running this process", () => {
    expect(resolveMadangdPath('exe')).toBe(process.execPath)
  })

  it("keeps 'logs' inside the data root so the whole deployment is one directory", () => {
    vi.stubEnv('MADANG_USER_DATA', join(sep, 'srv', 'orca-state'))
    expect(resolveMadangdPath('logs')).toBe(join(sep, 'srv', 'orca-state', 'logs'))
  })

  it("answers 'home' and 'temp' from the OS", () => {
    expect(resolveMadangdPath('home')).toBe(homedir())
    expect(resolveMadangdPath('temp')).toBe(tmpdir())
  })

  it("answers 'appData' with the per-user application-data root of each platform", () => {
    setPlatform('darwin')
    expect(resolveMadangdPath('appData')).toBe(join(homedir(), 'Library', 'Application Support'))

    setPlatform('win32')
    vi.stubEnv('APPDATA', join('C:', 'Users', 'orca', 'AppData', 'Roaming'))
    expect(resolveMadangdPath('appData')).toBe(join('C:', 'Users', 'orca', 'AppData', 'Roaming'))
    vi.stubEnv('APPDATA', '')
    expect(resolveMadangdPath('appData')).toBe(join(homedir(), 'AppData', 'Roaming'))

    setPlatform('linux')
    vi.stubEnv('XDG_CONFIG_HOME', join(sep, 'xdg-config'))
    expect(resolveMadangdPath('appData')).toBe(join(sep, 'xdg-config'))
    vi.stubEnv('XDG_CONFIG_HOME', '')
    expect(resolveMadangdPath('appData')).toBe(join(homedir(), '.config'))
  })

  it("answers 'downloads' from XDG_DOWNLOAD_DIR before the home default", () => {
    vi.stubEnv('XDG_DOWNLOAD_DIR', join(sep, 'srv', 'incoming'))
    expect(resolveMadangdPath('downloads')).toBe(join(sep, 'srv', 'incoming'))

    vi.stubEnv('XDG_DOWNLOAD_DIR', '')
    expect(resolveMadangdPath('downloads')).toBe(join(homedir(), 'Downloads'))
  })
})

describe('resolveMadangdInstallRoot', () => {
  it('is the directory holding the running bundle, not the working directory', () => {
    expect(resolveMadangdInstallRoot(join(sep, 'opt', 'orca', 'madangd.js'))).toBe(
      resolve(sep, 'opt', 'orca')
    )
  })

  it('absolutizes a relative script path against the working directory', () => {
    expect(resolveMadangdInstallRoot(join('out', 'madangd', 'madangd.js'))).toBe(
      join(process.cwd(), 'out', 'madangd')
    )
  })

  // Bundle siblings live beside symlink targets, not the link.
  it.skipIf(process.platform === 'win32')('follows a symlinked script to the real bundle', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'madangd-install-root-')))
    try {
      const bundle = join(root, 'slot')
      const bin = join(root, 'bin')
      mkdirSync(bundle)
      mkdirSync(bin)
      writeFileSync(join(bundle, 'madangd.js'), '')
      symlinkSync(join(bundle, 'madangd.js'), join(bin, 'madangd'))
      expect(resolveMadangdInstallRoot(join(bin, 'madangd'))).toBe(bundle)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses instead of guessing when the process has no main script', () => {
    const originalArgv = process.argv
    // node -e omits argv[1]; cwd cannot establish the install root.
    process.argv = [process.execPath]
    try {
      expect(() => resolveMadangdInstallRoot()).toThrow(/madangd_install_root_unavailable/)
    } finally {
      process.argv = originalArgv
    }
  })
})
