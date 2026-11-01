import { describe, expect, it } from 'vitest'
import { applyLegacyEnvAliases, withLegacyEnvMirror } from './orca-compat-env'

describe('applyLegacyEnvAliases', () => {
  it('copies an old name to the new one and keeps the old one', () => {
    const env: NodeJS.ProcessEnv = { ORCA_USER_DATA_PATH: 'C:/data', PATH: '/bin' }
    applyLegacyEnvAliases(env)
    expect(env).toEqual({
      ORCA_USER_DATA_PATH: 'C:/data',
      MADANG_USER_DATA_PATH: 'C:/data',
      PATH: '/bin'
    })
  })

  it('never overwrites a value the new name already has', () => {
    const env: NodeJS.ProcessEnv = { ORCA_PANE_KEY: 'old', MADANG_PANE_KEY: 'new' }
    applyLegacyEnvAliases(env)
    expect(env.MADANG_PANE_KEY).toBe('new')
  })

  it('does nothing when no old name is present', () => {
    const env: NodeJS.ProcessEnv = { MADANG_TAB_ID: 'tab' }
    applyLegacyEnvAliases(env)
    expect(env).toEqual({ MADANG_TAB_ID: 'tab' })
  })
})

describe('withLegacyEnvMirror', () => {
  it('adds the old name for every new name without touching the input', () => {
    const input = { MADANG_PANE_KEY: 'tab:pane', PATH: '/bin' }
    const out = withLegacyEnvMirror(input)
    expect(out).toEqual({ MADANG_PANE_KEY: 'tab:pane', ORCA_PANE_KEY: 'tab:pane', PATH: '/bin' })
    expect(input).toEqual({ MADANG_PANE_KEY: 'tab:pane', PATH: '/bin' })
  })

  it('drops an old name the app did not set, so a stale pane key cannot reach the child', () => {
    const out = withLegacyEnvMirror({ ORCA_PANE_KEY: 'spoofed', MADANG_TAB_ID: 'tab' })
    expect(out).toEqual({ MADANG_TAB_ID: 'tab', ORCA_TAB_ID: 'tab' })
  })

  it('skips new names with no value', () => {
    expect(withLegacyEnvMirror({ MADANG_WORKTREE_ID: undefined })).toEqual({
      MADANG_WORKTREE_ID: undefined
    })
  })
})
