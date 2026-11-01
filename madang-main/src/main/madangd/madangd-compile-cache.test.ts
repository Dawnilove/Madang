import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MADANGD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/madangd-managed-launch-env'
import {
  MADANGD_COMPILE_CACHE_DIRNAME,
  enableManagedMadangdCompileCache,
  madangdCompileCacheEnv
} from './madangd-compile-cache'

const managed = {
  [MADANGD_MANAGED_ACTIVATION_ROOT_ENV]: '/home/u/.madang-remote/.fence'
}

describe('managed madangd compile cache', () => {
  it('caches inside a managed slot, where slot GC removes it with the slot', () => {
    const enableCompileCache = vi.fn()
    enableManagedMadangdCompileCache('/home/u/.madang-remote/madangd-1+ab', managed, {
      enableCompileCache
    })
    expect(enableCompileCache).toHaveBeenCalledWith(
      join('/home/u/.madang-remote/madangd-1+ab', MADANGD_COMPILE_CACHE_DIRNAME)
    )
  })

  it('never writes into a slot no client manages, such as a packaged app', () => {
    const enableCompileCache = vi.fn()
    enableManagedMadangdCompileCache('/Applications/Madang.app/madangd', {}, { enableCompileCache })
    expect(enableCompileCache).not.toHaveBeenCalled()
  })

  it('starts as before on a runtime without the API or with an unwritable slot', () => {
    expect(() => enableManagedMadangdCompileCache('/slot', managed, {})).not.toThrow()
    const enableCompileCache = vi.fn(() => {
      throw new Error('EACCES')
    })
    expect(() =>
      enableManagedMadangdCompileCache('/slot', managed, { enableCompileCache })
    ).not.toThrow()
  })

  it('hands the preflight child the slot cache only when this process enabled one', () => {
    const enabled = { getCompileCacheDir: () => '/slot/x/v24' }
    expect(madangdCompileCacheEnv('/slot', enabled, managed)).toEqual({
      NODE_COMPILE_CACHE: join('/slot', MADANGD_COMPILE_CACHE_DIRNAME)
    })
    expect(madangdCompileCacheEnv('/slot', { getCompileCacheDir: () => undefined }, managed)).toEqual(
      {}
    )
    expect(madangdCompileCacheEnv('/slot', {}, managed)).toEqual({})
    expect(madangdCompileCacheEnv('/slot', enabled, {})).toEqual({})
  })
})
