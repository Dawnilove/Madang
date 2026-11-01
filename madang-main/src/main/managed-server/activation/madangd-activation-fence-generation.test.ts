import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { unusedMadangdHostTransport } from '../../ssh/unused-host-transport.test-fixture'

// Execute generated host guards in real local shells.
const shell = vi.hoisted((): { env: NodeJS.ProcessEnv | undefined } => ({ env: undefined }))
vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => {
  const { runProcess } = await import('@orca/process-host')
  return {
    ...(await importOriginal<typeof ExecCommandModule>()),
    execCommand: async (_conn: unknown, command: string) => {
      const result = await runProcess({ program: '/bin/sh', args: ['-c', command], env: shell.env })
      if (result.code !== 0) {
        const { sshCommandExitError } = await import('../../ssh/remote-exec/remote-exec-command')
        throw sshCommandExitError(command, result.code ?? 1, result.stdout)
      }
      return result.stdout
    }
  }
})

const { withMadangdActivationLock } = await import('./madangd-activation-lock')
const { madangdActivationFenceRefusal } = await import('./madangd-activation-fence-hold')
const { execMadangdRemote } = await import('../install/madangd-remote-runtime-control')
const { MadangdFenceLostError, runWithMadangdFence } = await import('./madangd-activation-fence-scope')
const { execMadangdStateMutation } = await import('../host-state/madangd-state-mutation-exec')
const { clearMadangdStateSnapshotMembersCommand } = await import('../host-state/madangd-state-snapshot')
const { getRemoteHostPlatform } = await import('../../ssh/ssh-remote-platform')

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('a superseded activation fence holder', () => {
  it('can neither act nor release once a successor took its fence over', async () => {
    const home = mkdtempSync(join(tmpdir(), 'madangd-fence-gen-'))
    homes.push(home)
    const root = join(home, '.madang-remote', '.madangd-activation-transaction')
    const fence = join(root, '.install-lock')
    const journal = join(root, 'transaction.json')
    const launched = join(home, 'launched-by-stale-holder')
    const conn = unusedMadangdHostTransport()
    const options = { conn, host: getRemoteHostPlatform('linux-x64'), remoteHome: home }

    let resumeStale!: () => void
    let staleEntered = false
    const stale = withMadangdActivationLock(
      options,
      async () => {
        staleEntered = true
        await new Promise<void>((resolve) => (resumeStale = resolve))
        await execMadangdRemote(options, `touch '${launched}'`)
        return 'acted'
      },
      () => 'held'
    )
    await vi.waitFor(() => expect(staleEntered).toBe(true))
    // Model a suspended holder by aging its unrefreshed fence.
    utimesSync(fence, new Date(0), new Date(0))
    expect(await madangdActivationFenceRefusal(options, 'update')).toMatchObject({ cleared: true })

    let resumeSuccessor!: () => void
    let successorEntered = false
    const successor = withMadangdActivationLock(
      options,
      async () => {
        writeFileSync(
          journal,
          JSON.stringify({ phase: 'mid-update', fenceToken: 'successor' }, null, 2)
        )
        successorEntered = true
        await new Promise<void>((resolve) => (resumeSuccessor = resolve))
        return 'done'
      },
      () => 'held',
      'successor'
    )
    await vi.waitFor(() => expect(successorEntered).toBe(true))

    resumeStale()
    await expect(stale).rejects.toBeInstanceOf(MadangdFenceLostError)
    expect(existsSync(launched)).toBe(false)
    expect(existsSync(fence)).toBe(true)
    expect(existsSync(journal)).toBe(true)

    resumeSuccessor()
    expect(await successor).toBe('done')
    expect(existsSync(fence)).toBe(false)
    expect(existsSync(journal)).toBe(false)
  })

  it('leaves a successor’s journal and lock when its own release resumes after a stall', async () => {
    const home = mkdtempSync(join(tmpdir(), 'madangd-fence-release-'))
    homes.push(home)
    const root = join(home, '.madang-remote', '.madangd-activation-transaction')
    const fence = join(root, '.install-lock')
    const journal = join(root, 'transaction.json')
    const bin = join(home, 'bin')
    const ready = join(home, 'ready')
    const resume = join(home, 'resume')
    mkdirSync(bin)
    // Stall the journal move immediately after release checks its token.
    writeFileSync(
      join(bin, 'mv'),
      `#!/bin/sh\nif [ "$1" = '${journal}' ] && [ ! -f '${ready}' ]; then touch '${ready}'; while [ ! -f '${resume}' ]; do sleep 0.05; done; fi\nexec /bin/mv "$@"\n`
    )
    chmodSync(join(bin, 'mv'), 0o755)
    const conn = unusedMadangdHostTransport()
    const options = { conn, host: getRemoteHostPlatform('linux-x64'), remoteHome: home }
    shell.env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` }
    let finishSuccessor: (() => void) | undefined
    let successor: Promise<unknown> | undefined
    const first = withMadangdActivationLock(
      options,
      async () => 'first',
      () => 'held',
      'first'
    )
    try {
      await vi.waitFor(() => expect(existsSync(ready)).toBe(true))
      utimesSync(fence, new Date(0), new Date(0))
      expect(await madangdActivationFenceRefusal(options, 'update')).toMatchObject({ cleared: true })
      successor = withMadangdActivationLock(
        options,
        async () => {
          writeFileSync(journal, JSON.stringify({ fenceToken: 'successor' }, null, 2))
          await new Promise<void>((resolve) => (finishSuccessor = resolve))
          return 'done'
        },
        () => 'held',
        'successor'
      )
      await vi.waitFor(() => expect(finishSuccessor).toBeDefined())
      writeFileSync(resume, '')
      expect(await first).toBe('first')
      expect(readFileSync(join(fence, '.orca-fence-owner'), 'utf8')).toBe('successor')
      expect(readFileSync(journal, 'utf8')).toContain('"fenceToken": "successor"')
    } finally {
      writeFileSync(resume, '')
      await first.catch(() => {})
      finishSuccessor?.()
      await successor
      shell.env = undefined
    }
  })

  it('refuses a superseded run’s state mutation before it touches profile state', async () => {
    const home = mkdtempSync(join(tmpdir(), 'madangd-fence-mutation-'))
    homes.push(home)
    const base = join(home, '.madang-remote')
    const root = join(home, 'root')
    const lockDir = join(base, '.madangd-activation-transaction', '.install-lock')
    mkdirSync(lockDir, { recursive: true })
    mkdirSync(join(root, 'profiles'), { recursive: true })
    writeFileSync(join(lockDir, '.orca-fence-owner'), 'successor')
    writeFileSync(join(root, 'profiles', 'state.json'), 'successor-state')
    const conn = unusedMadangdHostTransport()
    const options = { conn, host: getRemoteHostPlatform('linux-x64'), remoteHome: home }
    await expect(
      runWithMadangdFence({ lockDir, token: 'stale' }, () =>
        execMadangdStateMutation(
          options,
          clearMadangdStateSnapshotMembersCommand(options.host, root, base)
        )
      )
    ).rejects.toBeInstanceOf(MadangdFenceLostError)
    expect(readFileSync(join(root, 'profiles', 'state.json'), 'utf8')).toBe('successor-state')
  })
})
