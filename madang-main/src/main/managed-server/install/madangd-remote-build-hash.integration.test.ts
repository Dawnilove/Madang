import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { remoteMadangdBuildHashCommand } from './madangd-remote-build-hash'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

let directory = ''
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "madangd-hash-'quoted "))
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

it.skipIf(process.platform === 'win32').each([false, true])(
  'reads the installed build identity for split entry %s through a real POSIX shell',
  (splitEntry) => {
    const launcher = join(directory, 'madangd.js')
    writeFileSync(launcher, 'launcher\n')
    if (splitEntry) {
      writeFileSync(join(directory, 'madangd-server.js'), 'server\n')
    }
    const command = remoteMadangdBuildHashCommand(getRemoteHostPlatform('linux-x64'), directory)
    const run = (prefix = ''): string =>
      execFileSync('/bin/sh', ['-c', prefix + command], { encoding: 'utf8' }).trim()
    const legacyHash = createHash('sha256').update('launcher\n').digest('hex').slice(0, 16)
    const expected = `__MADANGD_BUILD_HASH__ ${legacyHash}`
    expect(run()).toBe(expected)
    expect(run('command() { [ "$2" = shasum ]; }; ')).toBe(expected)
  }
)

it.skipIf(process.platform === 'win32')(
  'refuses an absent launcher without publishing an empty-file hash',
  () => {
    const command = remoteMadangdBuildHashCommand(getRemoteHostPlatform('linux-x64'), directory)
    expect(() => execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).toThrow()
  }
)
