// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { CollaborationExperimentalSetting } from './CollaborationExperimentalSetting'
import { getDefaultSettings } from '../../../../shared/constants'

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))

describe('CollaborationExperimentalSetting', () => {
  it('installs the collaboration skill when the switch turns on', async () => {
    const bundledPlan = vi.fn().mockResolvedValue({ planDigest: 'digest' })
    const bundledExecute = vi.fn().mockResolvedValue({ scope: 'global', skills: [] })
    ;(window as unknown as { api: unknown }).api = { skills: { bundledPlan, bundledExecute } }
    const updateSettings = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <CollaborationExperimentalSetting
          settings={{ ...getDefaultSettings('/home'), experimentalCollaboration: false }}
          updateSettings={updateSettings}
        />
      )
    })
    await act(async () => {
      host.querySelector<HTMLElement>('[role="switch"]')?.click()
    })
    expect(updateSettings).toHaveBeenCalledWith({ experimentalCollaboration: true })
    expect(bundledPlan).toHaveBeenCalledWith({ names: ['collaboration'] })
    expect(bundledExecute).toHaveBeenCalledWith({
      planDigest: 'digest',
      request: { names: ['collaboration'] }
    })
  })
})
