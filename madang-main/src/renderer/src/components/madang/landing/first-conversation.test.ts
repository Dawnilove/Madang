import { describe, expect, it, vi } from 'vitest'
import {
  buildConversationDisplayName,
  buildConversationName,
  startFirstConversation,
  type FirstConversationDeps
} from './first-conversation'

function makeDeps(overrides: Partial<FirstConversationDeps> = {}): FirstConversationDeps {
  return {
    createWorktree: vi.fn(async () => ({ id: 'wt-new' })),
    activateWorktree: vi.fn(),
    launchAgent: vi.fn(),
    now: () => new Date(2026, 9, 27, 14, 5, 9),
    newSuffix: () => 'ab12',
    ...overrides
  }
}

describe('startFirstConversation', () => {
  it('creates one workspace and starts the agent with the typed text as its first message', async () => {
    const deps = makeDeps()
    const result = await startFirstConversation(
      { repoId: 'repo-1', agent: 'claude', text: '  로그인 버그 고쳐 줘  ' },
      deps
    )
    expect(result).toEqual({ ok: true, worktreeId: 'wt-new' })
    expect(deps.createWorktree).toHaveBeenCalledTimes(1)
    expect(deps.createWorktree).toHaveBeenCalledWith(
      'repo-1',
      'madang-20261027-140509-ab12',
      '로그인 버그 고쳐 줘'
    )
    expect(deps.launchAgent).toHaveBeenCalledWith({
      worktreeId: 'wt-new',
      agent: 'claude',
      prompt: '로그인 버그 고쳐 줘'
    })
  })

  it('opens the new workspace before the agent starts in it', async () => {
    const order: string[] = []
    const deps = makeDeps({
      activateWorktree: vi.fn(() => void order.push('activate')),
      launchAgent: vi.fn(() => void order.push('launch'))
    })
    await startFirstConversation({ repoId: 'r', agent: 'codex', text: 'hi' }, deps)
    expect(order).toEqual(['activate', 'launch'])
  })

  it('does nothing for an empty request', async () => {
    const deps = makeDeps()
    const result = await startFirstConversation({ repoId: 'r', agent: 'claude', text: '   ' }, deps)
    expect(result).toEqual({ ok: false, reason: 'empty' })
    expect(deps.createWorktree).not.toHaveBeenCalled()
  })

  it('starts no agent when the workspace cannot be created', async () => {
    const failing = makeDeps({
      createWorktree: vi.fn(async () => {
        throw new Error('branch exists')
      })
    })
    expect(
      await startFirstConversation({ repoId: 'r', agent: 'claude', text: 'x' }, failing)
    ).toEqual({ ok: false, reason: 'create-failed', message: 'branch exists' })
    expect(failing.launchAgent).not.toHaveBeenCalled()

    const empty = makeDeps({ createWorktree: vi.fn(async () => null) })
    expect(
      (await startFirstConversation({ repoId: 'r', agent: 'claude', text: 'x' }, empty)).ok
    ).toBe(false)
    expect(empty.launchAgent).not.toHaveBeenCalled()
  })
})

describe('conversation names', () => {
  it('keeps the folder name ASCII and the display name to one short line', () => {
    expect(buildConversationName(new Date(2026, 0, 2, 3, 4, 5), 'zz99')).toBe(
      'madang-20260102-030405-zz99'
    )
    expect(buildConversationDisplayName('줄 1\n줄 2')).toBe('줄 1 줄 2')
    expect(buildConversationDisplayName('가'.repeat(60))).toBe(`${'가'.repeat(40)}…`)
  })
})
