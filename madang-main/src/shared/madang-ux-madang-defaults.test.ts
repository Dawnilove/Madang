import { afterEach, describe, expect, it, vi } from 'vitest'
import { createE2EConfig } from './e2e-config'
import { getDefaultSettings } from './constants'
import {
  isOrcaDefaultsRequested,
  MADANG_UX,
  ORCA_UX_DEFAULTS,
  resolveMadangUx
} from './madang-features'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Orca defaults for e2e runs', () => {
  it('keeps Madang values unless Orca defaults are requested', () => {
    expect(resolveMadangUx(false)).toBe(MADANG_UX)
    expect(resolveMadangUx(true)).toBe(ORCA_UX_DEFAULTS)
    expect(resolveMadangUx(true).madangShell).toBe(false)
    expect(resolveMadangUx(false).madangShell).toBe(true)
  })

  it('differs from Madang on every switch, so none is forgotten', () => {
    for (const key of Object.keys(MADANG_UX) as (keyof typeof MADANG_UX)[]) {
      expect(ORCA_UX_DEFAULTS[key], key).not.toBe(MADANG_UX[key])
    }
  })

  it('reads the launch variable only when it is exactly 1', () => {
    expect(isOrcaDefaultsRequested({ MADANG_E2E_ORCA_DEFAULTS: '1' })).toBe(true)
    expect(isOrcaDefaultsRequested({ MADANG_E2E_ORCA_DEFAULTS: 'true' })).toBe(false)
    expect(isOrcaDefaultsRequested({})).toBe(false)
  })

  it('carries the request in the e2e config without enabling e2e by itself', () => {
    expect(createE2EConfig({ orcaDefaults: true }).orcaDefaults).toBe(true)
    expect(createE2EConfig({}).orcaDefaults).toBe(false)
    expect(createE2EConfig({ orcaDefaults: true }).enabled).toBe(false)
  })

  it('starts profiles with Orca values when the launch variable is set', () => {
    const madang = getDefaultSettings('/home/test')
    expect(madang.experimentalNativeChat).toBe(true)
    expect(madang.uiLanguage).toBe('ko')

    vi.stubEnv('MADANG_E2E_ORCA_DEFAULTS', '1')
    const orca = getDefaultSettings('/home/test')
    expect(orca.experimentalNativeChat).toBe(false)
    expect(orca.uiLanguage).toBe('system')
    expect(orca.showMobileButton).toBe(true)
  })
})
