import { describe, expect, it } from 'vitest'
import { formatNativeChatReply } from './native-chat-quote-selection'

describe('formatNativeChatReply', () => {
  it('quotes each line of a short message and leaves room to type below', () => {
    expect(formatNativeChatReply('first\n\nsecond')).toBe('> first\n>\n> second\n\n')
  })

  it('cuts a very long message so the quote stays small', () => {
    const quoted = formatNativeChatReply('x'.repeat(5000))
    expect(quoted.length).toBeLessThan(1300)
    expect(quoted).toContain('…')
  })
})
