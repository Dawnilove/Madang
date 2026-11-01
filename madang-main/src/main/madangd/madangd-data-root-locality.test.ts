import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { madangdDataRootIsOnLocalDisk } from './madangd-data-root-locality'

describe('madangdDataRootIsOnLocalDisk', () => {
  it.runIf(process.platform === 'linux' || process.platform === 'darwin')(
    'recognises a local temp directory, and refuses a path it cannot inspect',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'madangd-locality-'))
      try {
        expect(madangdDataRootIsOnLocalDisk(root)).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
      expect(madangdDataRootIsOnLocalDisk(join(root, 'missing'))).toBe(false)
    }
  )

  it('treats a Windows UNC data root as reachable from other machines', () => {
    expect(madangdDataRootIsOnLocalDisk('\\\\filer\\home\\orca', 'win32')).toBe(false)
    expect(madangdDataRootIsOnLocalDisk('\\\\?\\UNC\\filer\\home\\orca', 'win32')).toBe(false)
    expect(madangdDataRootIsOnLocalDisk('C:\\Users\\u\\AppData\\Roaming\\orca', 'win32')).toBe(true)
    expect(madangdDataRootIsOnLocalDisk('\\\\?\\C:\\Users\\u\\orca', 'win32')).toBe(true)
  })
})
