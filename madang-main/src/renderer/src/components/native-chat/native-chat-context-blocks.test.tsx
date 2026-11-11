// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addNativeChatContextBlock,
  clearNativeChatContextBlocks,
  nativeChatContextText,
  readNativeChatContextBlocks,
  removeNativeChatContextBlock
} from './native-chat-context-blocks'
import { nativeChatContextPreview } from './NativeChatContextBlocks'
import { useNativeChatComposerSubmit } from './use-native-chat-composer-submit'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

const SCOPE = 'tab-ctx:pane'

afterEach(() => clearNativeChatContextBlocks(SCOPE))

describe('native chat context blocks', () => {
  it('keeps cards per scope in order and joins their full text with blank lines', () => {
    addNativeChatContextBlock(SCOPE, { kind: 'reply', label: '', text: '> hello\n> world\n\n' })
    addNativeChatContextBlock(SCOPE, { kind: 'command', label: '$ ls', text: '```\n$ ls\na\n```' })
    expect(readNativeChatContextBlocks('other')).toHaveLength(0)
    expect(nativeChatContextText(SCOPE)).toBe('> hello\n> world\n\n```\n$ ls\na\n```\n\n')

    removeNativeChatContextBlock(SCOPE, readNativeChatContextBlocks(SCOPE)[0]!.id)
    expect(readNativeChatContextBlocks(SCOPE).map((block) => block.kind)).toEqual(['command'])
  })

  it('previews the first text line without quote marks or fences', () => {
    expect(nativeChatContextPreview('> first\n> second\n\n')).toEqual({
      line: 'first',
      lineCount: 2
    })
    expect(nativeChatContextPreview('```\n$ npm test\nok\n```\n\n').line).toBe('$ npm test')
    // The label already says the command, so the preview moves on to its output.
    expect(nativeChatContextPreview('```\n$ npm test\nok\n```\n\n', '$ npm test').line).toBe('ok')
  })
})

describe('send with context cards', () => {
  function submit(draft: string, lane: 'structured' | 'pty') {
    const calls = {
      sendPty: vi.fn(),
      sendStructured: vi.fn(),
      setDraft: vi.fn(),
      setCaret: vi.fn(),
      onContextSent: vi.fn()
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: submit reads only onError here.
    const structuredTransport = {
      capturePresentation: () => () => true,
      onError: vi.fn()
    } as unknown as NativeChatStructuredComposerTransport
    const hook = renderHook(() =>
      useNativeChatComposerSubmit({
        structuredTransport: lane === 'pty' ? undefined : structuredTransport,
        draftScopeKey: SCOPE,
        draft,
        caret: draft.length,
        imageAttachments: [],
        disabled: false,
        contextText: '> quoted\n\n',
        ...calls
      })
    )
    hook.result.current.send()
    return calls
  }

  it('sends the card text in front of the typed text and clears the cards', () => {
    const calls = submit('why?', 'structured')
    expect(calls.sendStructured).toHaveBeenCalledWith('> quoted\n\nwhy?', [])
    expect(calls.onContextSent).toHaveBeenCalledTimes(1)
  })

  it('sends cards alone when nothing is typed', () => {
    const calls = submit('', 'structured')
    expect(calls.sendStructured).toHaveBeenCalledWith('> quoted\n\n', [])
  })

  it('clears cards after a PTY send, which reads the combined draft itself', () => {
    const calls = submit('why?', 'pty')
    expect(calls.sendPty).toHaveBeenCalledTimes(1)
    expect(calls.onContextSent).toHaveBeenCalledTimes(1)
  })
})
