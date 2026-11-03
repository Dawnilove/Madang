import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getManagedAgentHookStatuses,
  installManagedAgentHooks
} from './managed-agent-hook-controls'

describe('installManagedAgentHooks in the company edition', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('only reports the statuses already on disk; it installs and refreshes nothing', async () => {
    vi.stubGlobal('MADANG_EDITION', 'company')
    const before = getManagedAgentHookStatuses()
    const reported = await installManagedAgentHooks({ disabledTuiAgents: [] }, {})
    expect(reported).toEqual(before)
    expect(getManagedAgentHookStatuses()).toEqual(before)
  })
})
