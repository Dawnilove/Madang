import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import type { RunChatCommandArgs, RunChatCommandResult } from '../../shared/ai-vault-types'

const TIMEOUT_MS = 60_000
// Keep the tail: a build or test run puts what matters (the failure) last.
const OUTPUT_LIMIT_BYTES = 40_000

// Why: the output is read as UTF-8, but PowerShell writes the OEM code page (CP949 on Korean Windows), which turns Hangul into garbage.
const POWERSHELL_UTF8_PREFIX =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '

function shellFor(command: string): { file: string; args: string[] } {
  return process.platform === 'win32'
    ? {
        file: 'powershell.exe',
        args: [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          POWERSHELL_UTF8_PREFIX + command
        ]
      }
    : { file: '/bin/sh', args: ['-c', command] }
}

/** Runs one command typed with `!` in a chat, in the chat's workspace folder, and returns its output as text. */
export function runChatCommand(
  args: RunChatCommandArgs | undefined
): Promise<RunChatCommandResult> {
  const command = typeof args?.command === 'string' ? args.command.trim() : ''
  const cwd = typeof args?.cwd === 'string' ? args.cwd : ''
  if (!command) {
    return Promise.resolve({
      output: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      error: 'empty'
    })
  }
  try {
    if (!statSync(cwd).isDirectory()) {
      throw new Error('not a directory')
    }
  } catch {
    return Promise.resolve({
      output: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      error: 'bad-cwd'
    })
  }
  return new Promise((resolve) => {
    const { file, args: shellArgs } = shellFor(command)
    const child = spawn(file, shellArgs, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = Buffer.alloc(0)
    let truncated = false
    let timedOut = false
    const collect = (chunk: Buffer): void => {
      output = Buffer.concat([output, chunk])
      if (output.length > OUTPUT_LIMIT_BYTES) {
        output = output.subarray(output.length - OUTPUT_LIMIT_BYTES)
        truncated = true
      }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && child.pid) {
        // The shell's children outlive a plain kill on Windows.
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
      } else {
        child.kill('SIGKILL')
      }
    }, TIMEOUT_MS)
    const finish = (exitCode: number | null, error?: string): void => {
      clearTimeout(timer)
      resolve({
        output: output.toString('utf8'),
        exitCode,
        timedOut,
        truncated,
        ...(error ? { error } : {})
      })
    }
    child.on('error', (error) => finish(null, error.message))
    child.on('close', (code) => finish(code))
  })
}
