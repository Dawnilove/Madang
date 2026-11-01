import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeMaintenanceModule from '../../ssh/madangd-runtime-maintenance'
import { getRemoteHostPlatform, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { sshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { MADANGD_INSTALL_MODEL } from '../install/remote-install-model'
import { computeRemoteInstallDir } from '../install/remote-versioned-install'

const mocks = vi.hoisted(() => {
  const host: { current: RemoteHostPlatform | null } = { current: null }
  const home = { current: '/home/dev' }
  return { host, home, exec: vi.fn(), wake: vi.fn(), rebuild: vi.fn(async () => {}) }
})

vi.mock('../../ssh/madangd-runtime-maintenance', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeMaintenanceModule>()),
  withManagedMadangdLifecycle: (
    _path: string,
    _selector: string,
    run: (managed: unknown) => Promise<unknown>
  ) => run({ environment: { id: 'env-1' }, deployment: { remotePort: 7777 } })
}))
vi.mock('./madangd-managed-runtime-context', () => ({
  resolveLinkedMadangdContext: async () => ({ host: mocks.host.current }),
  managedMadangdSlot: () => ({
    host: mocks.host.current,
    remoteHome: mocks.home.current,
    userDataDir: '/home/dev/.madang'
  })
}))
vi.mock('../activation/madangd-activation-lock', () => ({
  withMadangdActivationLock: (_slot: unknown, run: () => Promise<unknown>) => run()
}))
vi.mock('../activation/madangd-activation-record-store', () => ({
  readMadangdActivationRecord: async () => ({ active: '1.0.0' })
}))
vi.mock('./madangd-managed-wake', () => ({ wakeStoppedManagedMadangd: mocks.wake }))
vi.mock('./madangd-managed-tunnel', () => ({ rebuildMadangdManagedTunnel: mocks.rebuild }))
vi.mock('../install/madangd-remote-runtime-control', () => ({ execMadangdRemote: mocks.exec }))

const { runManagedMadangdStaleLockReclaim } = await import('./madangd-managed-stale-lock-reclaim')

const evidence = {
  pid: 41,
  host: 'box',
  bootId: 'b1',
  currentBootId: 'b2',
  ageMinutes: 90,
  nonce: 'n-1'
}
type AnswerExtras = { exitCode?: number; evidence?: typeof evidence }

const answer = (status: string, extra: AnswerExtras = {}) =>
  JSON.stringify({ status, lockPath: '/home/dev/.madang/madangd.lock', message: status, ...extra })

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.home.current = '/home/dev'
  mocks.host.current = getRemoteHostPlatform('linux-x64')
  mocks.wake.mockResolvedValue({ outcome: 'started', readiness: {} })
  mocks.rebuild.mockResolvedValue(undefined)
})

describe('runManagedMadangdStaleLockReclaim', () => {
  it('reads the dry run’s evidence from the command’s exit-2 output', async () => {
    mocks.exec.mockRejectedValue(
      sshCommandExitError('madangd', 2, `${answer('eligible', { exitCode: 2, evidence })}\n`)
    )
    await expect(runManagedMadangdStaleLockReclaim('/u', 'env-1', { yes: false })).resolves.toEqual({
      status: 'eligible',
      lockPath: '/home/dev/.madang/madangd.lock',
      message: 'eligible',
      evidence
    })
    const command: string = mocks.exec.mock.calls[0][1]
    expect(command).toContain("--reclaim-stale-lock --data-root '/home/dev/.madang' --json")
    expect(command).not.toContain('--yes')
    // Dry runs gate slot support but do not pass a nonce to the reclaim command.
    expect(command.split('--expect-nonce')).toHaveLength(2)
    expect(mocks.wake).not.toHaveBeenCalled()
  })

  it('never guesses from an madangd that answers without JSON', async () => {
    mocks.exec.mockRejectedValue(sshCommandExitError('madangd', 1, 'Error: lock held'))
    const result = await runManagedMadangdStaleLockReclaim('/u', 'env-1', {
      yes: true,
      expectNonce: 'n-1'
    })
    expect(result).toEqual({ status: 'no-answer', message: expect.any(String) })
    expect(mocks.wake).not.toHaveBeenCalled()
  })

  it('keeps the reclaimed result when the wake throws after the lock is gone', async () => {
    mocks.wake.mockRejectedValue(new Error('readiness timed out'))
    mocks.exec.mockResolvedValue(`${answer('reclaimed', { exitCode: 0, evidence })}\n`)
    const result = await runManagedMadangdStaleLockReclaim('/u', 'env-1', {
      yes: true,
      expectNonce: 'n-1'
    })
    expect(result).toMatchObject({
      status: 'reclaimed',
      environmentId: 'env-1',
      evidence,
      notRestarted: expect.stringContaining('readiness timed out')
    })
  })

  it('reports a started server as restarted even when its forward could not follow it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.rebuild.mockRejectedValue(new Error('forward refused'))
    mocks.exec.mockResolvedValue(`${answer('reclaimed', { exitCode: 0, evidence })}\n`)
    const result = await runManagedMadangdStaleLockReclaim('/u', 'env-1', {
      yes: true,
      expectNonce: 'n-1'
    })
    expect(result).toMatchObject({ status: 'reclaimed', evidence })
    expect(result).not.toHaveProperty('notRestarted')
  })

  it('reads a status a newer madangd added as no answer', async () => {
    mocks.exec.mockRejectedValue(sshCommandExitError('madangd', 5, `${answer('deferred')}\n`))
    const result = await runManagedMadangdStaleLockReclaim('/u', 'env-1', { yes: false })
    expect(result.status).toBe('no-answer')
  })

  it('names the lock to delete by hand only for a slot without the command', async () => {
    mocks.exec.mockResolvedValue('MADANG_STALE_LOCK_RECLAIM_UNSUPPORTED\n')
    const result = await runManagedMadangdStaleLockReclaim('/u', 'env-1', { yes: false })
    expect(result).toMatchObject({
      status: 'unsupported',
      lockPath: '/home/dev/.madang/madangd.lock'
    })
  })

  it('runs nothing on a host whose starts never refuse a shared-home lock', async () => {
    mocks.host.current = getRemoteHostPlatform('darwin-arm64')
    const result = await runManagedMadangdStaleLockReclaim('/u', 'env-1', {
      yes: true,
      expectNonce: 'n-1'
    })
    expect(result.status).toBe('unsupported')
    expect(mocks.exec).not.toHaveBeenCalled()
  })

  it('starts the server again once the confirmed reclaim cleared the lock', async () => {
    mocks.exec.mockResolvedValue(`${answer('reclaimed', { exitCode: 0, evidence })}\n`)
    const result = await runManagedMadangdStaleLockReclaim('/u', 'env-1', {
      yes: true,
      expectNonce: 'n-1'
    })
    expect(mocks.exec.mock.calls[0][1]).toContain("--json --expect-nonce 'n-1' --yes")
    expect(result).toMatchObject({ status: 'reclaimed', environmentId: 'env-1', evidence })
    expect(result).not.toHaveProperty('notRestarted')
    expect(mocks.wake).toHaveBeenCalledOnce()
    expect(mocks.rebuild).toHaveBeenCalledWith('/u', 'env-1')
  })

  // A silent fake runtime distinguishes unsupported slots from commands that ran without a reply.
  it.skipIf(process.platform === 'win32').each([
    [
      'never starts an madangd that has the reclaim but not the pin',
      'argv[2] === "--reclaim-stale-lock"',
      false,
      { status: 'unsupported', reclaimWithoutPin: true }
    ],
    [
      'never starts an madangd without the reclaim',
      'madangd server',
      false,
      { status: 'unsupported', lockPath: expect.stringContaining('madangd.lock') }
    ],
    [
      'runs the slot that names the pin',
      '"--reclaim-stale-lock" "--expect-nonce"',
      true,
      { status: 'no-answer' }
    ]
  ])('%s', async (_case, bundle, invoked, expected) => {
    const home = mkdtempSync(join(tmpdir(), 'madangd-reclaim-gate-'))
    roots.push(home)
    mocks.home.current = home
    const slotDir = computeRemoteInstallDir(MADANGD_INSTALL_MODEL, home, '1.0.0')
    mkdirSync(slotDir, { recursive: true })
    writeFileSync(join(slotDir, 'madangd-server.js'), bundle)
    writeFileSync(join(slotDir, '.build-target'), 'linux-x64')
    const runtime = join(slotDir, 'bun-runtime')
    writeFileSync(runtime, `#!/bin/sh\ntouch ${quotePosixShell(join(home, 'invoked'))}\n`)
    chmodSync(runtime, 0o755)
    mocks.exec.mockImplementation(async (_slot: unknown, command: string) => {
      const { stdout } = await runProcess({ program: '/bin/sh', args: ['-c', command] })
      return stdout
    })
    const result = await runManagedMadangdStaleLockReclaim('/u', 'env-1', {
      yes: true,
      expectNonce: 'n-1'
    })
    expect(result).toMatchObject(expected)
    expect(existsSync(join(home, 'invoked'))).toBe(invoked)
  })
})
