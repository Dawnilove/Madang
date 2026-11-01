import { describe, expect, it, vi } from 'vitest'

// Return the key so the test proves the label went through translation, not the English text.
vi.mock('@/i18n/i18n', () => ({ translate: (key: string) => `t:${key}` }))

import { nativeChatPermissionFallbackLabel } from './native-chat-permission-mode-labels'

describe('nativeChatPermissionFallbackLabel', () => {
  it("translates the main process's generic 'Permissions' description", () => {
    expect(nativeChatPermissionFallbackLabel(undefined, 'Permissions')).toBe(
      't:components.native-chat.composer.permissions'
    )
    expect(nativeChatPermissionFallbackLabel(undefined, undefined)).toBe(
      't:components.native-chat.composer.permissions'
    )
  })

  it('translates plan and read-only by value, whatever the English description says', () => {
    expect(nativeChatPermissionFallbackLabel('plan', 'Plan mode')).toBe(
      't:components.native-chat.composer.permissionPlan'
    )
    expect(nativeChatPermissionFallbackLabel('read-only', 'Read only')).toBe(
      't:components.native-chat.composer.permissionReadOnly'
    )
  })

  it('keeps an agent-specific raw value that has no translation', () => {
    expect(nativeChatPermissionFallbackLabel('bypassPermissions', 'bypassPermissions')).toBe(
      'bypassPermissions'
    )
  })
})
