import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stampMadangdAppVersion } from './madangd-host-adapters'

describe('the Madang version a server reports', () => {
  let root: string
  let saved: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'madangd-app-version-'))
    saved = process.env.MADANG_APP_VERSION
    delete process.env.MADANG_APP_VERSION
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    if (saved === undefined) {
      delete process.env.MADANG_APP_VERSION
    } else {
      process.env.MADANG_APP_VERSION = saved
    }
  })

  it('is the release its bundle was built from, not a dev placeholder', () => {
    mkdirSync(join(root, 'out', 'cli'), { recursive: true })
    writeFileSync(join(root, 'out', 'package.json'), JSON.stringify({ version: '1.4.224' }))
    stampMadangdAppVersion(() => root)
    expect(process.env.MADANG_APP_VERSION).toBe('1.4.224')
  })

  it('replaces a version inherited from the Madang that started it', () => {
    process.env.MADANG_APP_VERSION = '1.4.300'
    mkdirSync(join(root, 'out'), { recursive: true })
    writeFileSync(join(root, 'out', 'package.json'), JSON.stringify({ version: '1.4.224' }))
    stampMadangdAppVersion(() => root)
    expect(process.env.MADANG_APP_VERSION).toBe('1.4.224')
  })

  it('leaves the environment alone when the bundle has no version', () => {
    stampMadangdAppVersion(() => root)
    expect(process.env.MADANG_APP_VERSION).toBeUndefined()
    stampMadangdAppVersion(() => {
      throw new Error('madangd_install_root_unavailable')
    })
    expect(process.env.MADANG_APP_VERSION).toBeUndefined()
  })
})
