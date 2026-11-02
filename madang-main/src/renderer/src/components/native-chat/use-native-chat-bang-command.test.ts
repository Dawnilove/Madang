import { describe, expect, it } from 'vitest'
import {
  formatNativeChatBangResult,
  parseNativeChatBangDraft
} from './use-native-chat-bang-command'

describe('parseNativeChatBangDraft', () => {
  it('returns the command of a single-line !draft', () => {
    expect(parseNativeChatBangDraft('!npm test')).toBe('npm test')
    expect(parseNativeChatBangDraft('  ! git status  ')).toBe('git status')
  })

  it('ignores ordinary text, a bare !, and multi-line drafts', () => {
    expect(parseNativeChatBangDraft('hello !world')).toBeNull()
    expect(parseNativeChatBangDraft('!')).toBeNull()
    expect(parseNativeChatBangDraft('!echo a\nsecond line')).toBeNull()
  })
})

describe('formatNativeChatBangResult', () => {
  const ok = { output: 'a\nb\n', exitCode: 0, timedOut: false, truncated: false }

  it('puts the command and its output in one fenced block', () => {
    expect(formatNativeChatBangResult('ls', ok)).toBe('```\n$ ls\na\nb\n```\n\n')
  })

  it('notes a failing exit code and a cut output', () => {
    const text = formatNativeChatBangResult('make', { ...ok, exitCode: 2, truncated: true })
    expect(text).toContain('exit code 2')
    expect(text).toContain('only the last part is shown')
  })

  it('uses a longer fence when the output holds backticks', () => {
    const text = formatNativeChatBangResult('cat x', { ...ok, output: '```js\nx\n```\n' })
    expect(text.startsWith('````\n$ cat x')).toBe(true)
  })
})
