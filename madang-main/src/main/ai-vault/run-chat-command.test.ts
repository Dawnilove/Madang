import { describe, expect, it } from 'vitest'
import { runChatCommand } from './run-chat-command'

// A command both PowerShell and sh run unchanged.
const echoCommand = (text: string): string => `echo ${text}`

describe('runChatCommand', () => {
  it('runs the command in the folder and returns its output and exit code', async () => {
    const result = await runChatCommand({ cwd: process.cwd(), command: echoCommand('hello-chat') })
    expect(result.output).toContain('hello-chat')
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
  })

  it('reports a failing command through its exit code', async () => {
    const result = await runChatCommand({ cwd: process.cwd(), command: 'exit 3' })
    expect(result.exitCode).toBe(3)
  })

  it('refuses an empty command and a folder that does not exist', async () => {
    expect((await runChatCommand({ cwd: process.cwd(), command: '  ' })).error).toBe('empty')
    expect((await runChatCommand({ cwd: '/no/such/folder/here', command: 'echo x' })).error).toBe(
      'bad-cwd'
    )
  })
})
