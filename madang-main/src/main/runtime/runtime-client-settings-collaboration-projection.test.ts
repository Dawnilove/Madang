import { describe, expect, it } from 'vitest'
import { RuntimeClientSettingsController } from './runtime-client-settings'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import type { GlobalSettings } from '../../shared/global-settings-types'

// The CLI gate for `madang skills get collaboration` reads this projection; a missing key keeps the rules off forever.
function projectionOf(settings: Partial<GlobalSettings>) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: get() reads nothing but store.getSettings(); every other RuntimeStore member is unreachable from that path.
  return new RuntimeClientSettingsController({ getSettings: () => settings } as never).get()
}

function hostSettings(overrides: Partial<GlobalSettings>): Partial<GlobalSettings> {
  return { ...createGlobalSettingsFixture({ workspaceDir: '/w' }), ...overrides }
}

describe('RuntimeClientSettingsController collaboration projection', () => {
  it('publishes the collaboration switch when it is on', () => {
    expect(projectionOf(hostSettings({ experimentalCollaboration: true })).experimentalCollaboration).toBe(true)
  })

  it('publishes the collaboration switch when it is off', () => {
    expect(projectionOf(hostSettings({ experimentalCollaboration: false })).experimentalCollaboration).toBe(false)
  })

  it('reports off when the host has no persisted value', () => {
    const settings = hostSettings({})
    delete settings.experimentalCollaboration
    expect(projectionOf(settings).experimentalCollaboration).toBe(false)
  })
})
