import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isSafeUnicodeWindowsBatchHookPath,
  wrapWindowsHookCommand
} from '../agent-hooks/windows-hook-command'
import { wrapPosixHookCommand } from '../agent-hooks/posix-hook-command'
import { getMuseManagedCommand, getMuseRemoteManagedCommand } from './hook-settings'

afterEach(() => vi.restoreAllMocks())

describe('Muse hook commands', () => {
  it('dispatches safe Windows batch paths without PowerShell', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(getMuseManagedCommand('C:\\Users\\alice\\.madang\\agent-hooks\\muse-hook.cmd')).toBe(
      'C:/Users/alice/.madang/agent-hooks/muse-hook.cmd'
    )
  })

  it.each([
    'C:\\Users\\Alice Smith\\.madang\\agent-hooks\\muse-hook.cmd',
    'C:\\Users\\a&b\\.madang\\agent-hooks\\muse-hook.cmd',
    'C:\\Users\\a%b\\.madang\\agent-hooks\\muse-hook.cmd',
    "C:\\Users\\O'Brien\\.madang\\agent-hooks\\muse-hook.cmd",
    'C:\\Users\\日本語\\.madang\\agent-hooks\\muse-hook.cmd',
    '\\\\server\\share\\.madang\\agent-hooks\\muse-hook.cmd'
  ])('retains the established quoting fallback for %s', (path) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const policy = { useProcessPolicyEnvironment: isSafeUnicodeWindowsBatchHookPath(path) }
    expect(getMuseManagedCommand(path)).toBe(wrapWindowsHookCommand(path, {}, policy))
  })

  it.each(['darwin', 'linux'] as const)('keeps local %s commands POSIX', (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const path = '/home/alice smith/.madang/agent-hooks/muse-hook.sh'
    expect(getMuseManagedCommand(path)).toBe(wrapPosixHookCommand(path))
  })

  it('keeps SSH commands POSIX when the client runs Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const path = '/home/alice smith/.madang/agent-hooks/muse-hook.sh'
    expect(getMuseRemoteManagedCommand(path)).toBe(wrapPosixHookCommand(path))
  })
})
