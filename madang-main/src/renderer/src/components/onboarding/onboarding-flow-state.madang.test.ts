import { describe, expect, it } from 'vitest'
import {
  isFinalStepIndex,
  resolveStepIndex,
  shouldSkipIntegrationsStep,
  shouldSkipNotificationsStep
} from './onboarding-flow-state'
import { STEPS } from './use-onboarding-flow-types'

const index = (id: string): number => STEPS.findIndex((step) => step.id === id)

describe('Madang onboarding', () => {
  it('skips the integrations and notifications steps', () => {
    expect(shouldSkipIntegrationsStep(null)).toBe(true)
    expect(shouldSkipNotificationsStep()).toBe(true)
  })

  it('ends on the Windows terminal step on Windows', () => {
    const options = { skipIntegrations: true, skipWindowsTerminal: false, skipNotifications: true }
    expect(isFinalStepIndex(index('windows_terminal'), options)).toBe(true)
    expect(isFinalStepIndex(index('theme'), options)).toBe(false)
  })

  it('ends on the theme step elsewhere, and resuming past the end lands there', () => {
    const options = { skipIntegrations: true, skipWindowsTerminal: true, skipNotifications: true }
    expect(isFinalStepIndex(index('theme'), options)).toBe(true)
    expect(resolveStepIndex(index('notifications'), options, 'forward')).toBe(index('theme'))
  })

  it('keeps notifications final when it is not skipped', () => {
    const options = { skipIntegrations: false, skipWindowsTerminal: false }
    expect(isFinalStepIndex(index('notifications'), options)).toBe(true)
  })
})
