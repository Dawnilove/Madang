import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./madangd-browser-startup', () => ({
  startMadangdBrowserProvider: () => ({ ready: Promise.resolve(), stop: async () => {} })
}))

import { MADANGD_LOCK_FILE_NAME, readMadangdInstanceLockRecord } from './madangd-instance-lock'
import { startMadangdWithHost } from './madangd-lifecycle'
import { isDesktopBrowserBridgeHostEnabled } from '../runtime/desktop-browser-bridge/desktop-browser-bridge-registry'
import { MADANGD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/madangd-managed-launch-env'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function dataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'madangd-lifecycle-host-'))
  roots.push(root)
  return root
}

describe('startMadangdWithHost', () => {
  it('names the instance a managed stop must address, and releases its lock on a clean stop', async () => {
    const root = dataRoot()
    const handle = await startMadangdWithHost(
      root,
      async () => ({}),
      () => {}
    )
    expect(readMadangdInstanceLockRecord(handle.instance.lockPath)).toMatchObject({
      pid: handle.instance.pid,
      nonce: handle.instance.nonce
    })
    await handle.stop()
    expect(existsSync(join(root, MADANGD_LOCK_FILE_NAME))).toBe(false)
  })

  it('keeps the instance lock when a runtime writer could not be stopped', async () => {
    const root = dataRoot()
    const failure = new Error('profile writer still running')
    const handle = await startMadangdWithHost(
      root,
      async (registerCleanup) => {
        registerCleanup(() => {
          throw failure
        })
        return {}
      },
      () => {}
    )
    await expect(handle.stop()).rejects.toBe(failure)
    expect(existsSync(join(root, MADANGD_LOCK_FILE_NAME))).toBe(true)
  })

  it('keeps the instance lock when a quit handler fails', async () => {
    const root = dataRoot()
    const handle = await startMadangdWithHost(
      root,
      async () => ({}),
      () => {
        throw new AggregateError([new Error('handler')], 'madangd_quit_handlers_failed')
      }
    )
    await expect(handle.stop()).rejects.toThrow('madangd_quit_handlers_failed')
    expect(existsSync(join(root, MADANGD_LOCK_FILE_NAME))).toBe(true)
  })

  it.each([
    ['a managed launch', { [MADANGD_MANAGED_ACTIVATION_ROOT_ENV]: '/home/me/.orca-server' }, true],
    ['a server the user started', {}, false]
  ])('takes desktop browser bridge commands only for %s', async (_name, env, expected) => {
    vi.stubEnv(MADANGD_MANAGED_ACTIVATION_ROOT_ENV, env[MADANGD_MANAGED_ACTIVATION_ROOT_ENV] ?? '')
    try {
      const handle = await startMadangdWithHost(
        dataRoot(),
        async () => ({}),
        () => {}
      )
      expect(isDesktopBrowserBridgeHostEnabled()).toBe(expected)
      await handle.stop()
      expect(isDesktopBrowserBridgeHostEnabled()).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
