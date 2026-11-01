import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '@orca/process-host'
import {
  MADANGD_LOG_TAIL_LINES,
  MADANGD_LOG_TAIL_MAX_BYTES,
  madangdLogTailCommand,
  parseMadangdLogTail,
  withMadangdLogTail
} from './madangd-remote-log-tail'
import { MADANGD_WINDOWS_HOST_SCRIPT } from '../host-state/madangd-windows-host-script'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { unusedMadangdHostTransport } from '../../ssh/unused-host-transport.test-fixture'

const execCommand = vi.hoisted(() => vi.fn())
vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand
}))

const linux = getRemoteHostPlatform('linux-x64')
const windows = getRemoteHostPlatform('win32-x64')
const SLOT = '/home/me/.madang-remote/madangd-1.0.0'
const WINDOWS_SLOT = 'C:\\Users\\me\\.madang-remote\\madangd-1.0.0'
const conn = unusedMadangdHostTransport()

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'madangd-log-tail-'))
  execCommand.mockReset()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')
}

describe('madangd.log tail', () => {
  it('keeps only the last lines and bytes, redacting secrets', () => {
    const tail = parseMadangdLogTail(linux, `${numberedLines(100)}\ntoken=abc123secret\n`)
    const lines = (tail ?? '').split('\n')
    expect(lines).toHaveLength(MADANGD_LOG_TAIL_LINES)
    expect(lines[0]).toBe('line 62')
    expect(tail).not.toContain('abc123secret')
    expect(tail).toContain('[redacted')

    const huge = parseMadangdLogTail(linux, 'x'.repeat(MADANGD_LOG_TAIL_MAX_BYTES * 4))
    expect(Buffer.byteLength(huge ?? '', 'utf8')).toBeLessThanOrEqual(MADANGD_LOG_TAIL_MAX_BYTES)
    expect(parseMadangdLogTail(linux, '  \n')).toBeNull()
  })

  it('reads the log on Windows through the node.exe host script, never an encoded command', () => {
    const command = madangdLogTailCommand(windows, WINDOWS_SLOT)
    expect(command).toContain('node.exe')
    expect(command).toContain(' log-tail ')
    expect(command).not.toMatch(/EncodedCommand/iu)
  })

  it.skipIf(process.platform === 'win32')(
    'runs the POSIX command against a real file',
    async () => {
      const slot = join(dir, 'slot')
      mkdirSync(slot)
      writeFileSync(join(slot, 'madangd.log'), `${numberedLines(60)}\n`)
      const run = await runProcess({
        program: '/bin/sh',
        args: ['-c', madangdLogTailCommand(linux, slot)],
        timeoutMs: 5_000
      })
      expect(parseMadangdLogTail(linux, run.stdout)?.split('\n').at(-1)).toBe('line 60')
      const missing = await runProcess({
        program: '/bin/sh',
        args: ['-c', madangdLogTailCommand(linux, join(dir, 'absent'))],
        timeoutMs: 5_000
      })
      expect(parseMadangdLogTail(linux, missing.stdout)).toBeNull()
    }
  )

  it('reads the end of the log through the real Windows host script op', async () => {
    const script = join(dir, 'host-script.js')
    writeFileSync(script, MADANGD_WINDOWS_HOST_SCRIPT)
    const log = join(dir, 'madangd.log')
    writeFileSync(log, `${'y'.repeat(MADANGD_LOG_TAIL_MAX_BYTES * 2)}\nfatal: bind failed\n`)
    const run = await runProcess({
      program: process.execPath,
      args: [script, 'log-tail', log, String(MADANGD_LOG_TAIL_MAX_BYTES)],
      timeoutMs: 15_000
    })
    const tail = parseMadangdLogTail(windows, run.stdout)
    expect(tail?.endsWith('fatal: bind failed')).toBe(true)
    const absent = await runProcess({
      program: process.execPath,
      args: [script, 'log-tail', join(dir, 'absent.log'), '100'],
      timeoutMs: 15_000
    })
    expect(parseMadangdLogTail(windows, absent.stdout)).toBeNull()
  })

  it('appends the tail to a failure message, and leaves it alone when the host cannot answer', async () => {
    execCommand.mockResolvedValueOnce('starting\nError: EADDRINUSE\n')
    await expect(withMadangdLogTail({ conn, host: linux }, SLOT, 'Launch failed.')).resolves.toBe(
      'Launch failed.\nLast lines of madangd.log:\nstarting\nError: EADDRINUSE'
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    execCommand.mockRejectedValueOnce(new Error('Connection lost'))
    await expect(withMadangdLogTail({ conn, host: linux }, SLOT, 'Launch failed.')).resolves.toBe(
      'Launch failed.'
    )
    warn.mockRestore()
  })
})
