import { afterEach, describe, expect, it, vi } from 'vitest'
import { isCompanyEdition } from './madang-edition'
import { isAgentStatusHooksEnabled } from './agent-status-hooks-setting'

describe('company edition', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is off unless the build says company', () => {
    expect(isCompanyEdition()).toBe(false)
    vi.stubGlobal('MADANG_EDITION', 'standard')
    expect(isCompanyEdition()).toBe(false)
    vi.stubGlobal('MADANG_EDITION', 'company')
    expect(isCompanyEdition()).toBe(true)
  })

  it('keeps agent hooks off even when the setting says on', () => {
    expect(isAgentStatusHooksEnabled({ agentStatusHooksEnabled: true })).toBe(true)
    vi.stubGlobal('MADANG_EDITION', 'company')
    expect(isAgentStatusHooksEnabled({ agentStatusHooksEnabled: true })).toBe(false)
    expect(isAgentStatusHooksEnabled(undefined)).toBe(false)
  })
})
