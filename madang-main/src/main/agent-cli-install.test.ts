import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installAgentCli } from './agent-cli-install'

function fakeSpawn(exitCode: number) {
  const calls: { file: string; args: string[] }[] = []
  const spawn = ((file: string, args: string[]) => {
    calls.push({ file, args })
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('close', exitCode))
    return child
  }) as never
  return { spawn, calls }
}

describe('installAgentCli', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens PowerShell with the vendor one-liner for a listed agent', async () => {
    const { spawn, calls } = fakeSpawn(0)
    const result = await installAgentCli('claude', { platform: 'win32', spawn })
    expect(result).toEqual({ status: 'finished', exitCode: 0 })
    expect(calls[0]?.file).toBe('powershell.exe')
    expect(calls[0]?.args.join(' ')).toContain('irm https://claude.ai/install.ps1 | iex')
  })

  it('refuses agents that are not in the list, other platforms, and the company edition', async () => {
    const { spawn, calls } = fakeSpawn(0)
    expect(await installAgentCli('zcode', { platform: 'win32', spawn })).toEqual({
      status: 'unsupported'
    })
    expect(await installAgentCli('--evil', { platform: 'win32', spawn })).toEqual({
      status: 'unsupported'
    })
    expect(await installAgentCli('claude', { platform: 'darwin', spawn })).toEqual({
      status: 'unsupported'
    })
    vi.stubGlobal('MADANG_EDITION', 'company')
    expect(await installAgentCli('claude', { platform: 'win32', spawn })).toEqual({
      status: 'unsupported'
    })
    expect(calls).toHaveLength(0)
  })
})
