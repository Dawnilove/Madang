import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'
import { isNativeChatDefaultFor } from './structured-native-chat-launch-route'

// Madang product defaults that differ from upstream Orca; a merge must not silently undo them.
describe('Madang default settings', () => {
  const settings = getDefaultSettings('/home/user')

  it('starts new profiles in Chat UI', () => {
    expect(settings.experimentalNativeChat).toBe(true)
    expect(isNativeChatDefaultFor(settings, 'claude')).toBe(true)
    expect(isNativeChatDefaultFor(settings, 'codex')).toBe(true)
  })

  it('starts new profiles in Korean with the Mobile button hidden', () => {
    expect(settings.uiLanguage).toBe('ko')
    expect(settings.showMobileButton).toBe(false)
  })
})
