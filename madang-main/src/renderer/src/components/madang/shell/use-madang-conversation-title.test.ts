// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: {},
  projectGroups: [],
  worktreeCardProperties: [],
  fetchHostedReviewForBranch: vi.fn(),
  fetchIssue: vi.fn(),
  fetchLinearIssue: vi.fn()
}))
const review = vi.hoisted(() => ({
  branch: 'main',
  isFolder: false,
  hostedReviewCacheKey: 'review-key',
  issueCacheKey: 'issue-key',
  linearWorkspaceId: 'ws',
  linearSourceContext: undefined,
  linkedGitLabMR: null,
  linkedBitbucketPR: null,
  linkedAzureDevOpsPR: null,
  linkedGiteaPR: null
}))
const linked = vi.hoisted(() => ({ visibleCardTitle: 'PR title' }))

vi.mock('@/store', () => ({
  useAppStore: (selector: (value: typeof state) => unknown) => selector(state)
}))
vi.mock('@/lib/passive-macos-app-data-access', () => ({ isMacAppDataPath: () => false }))
vi.mock('@/components/sidebar/use-worktree-card-review-details', () => ({
  useWorktreeCardReviewDetails: () => review
}))
vi.mock('@/components/sidebar/use-worktree-card-linked-details', () => ({
  useWorktreeCardLinkedDetails: () => linked
}))

import { useMadangConversationTitle } from './use-madang-conversation-title'

const repo = { id: 'r1', path: '/repo' } as never
const makeWorktree = (displayName: string) =>
  ({ id: 'r1::/repo/wt', displayName, linkedIssue: 12, linkedPR: null }) as never

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('useMadangConversationTitle', () => {
  it('returns the card title and looks up GitHub while the name equals the branch', () => {
    const { result } = renderHook(() => useMadangConversationTitle(makeWorktree('main'), repo))
    expect(result.current).toBe('PR title')
    expect(state.fetchHostedReviewForBranch).toHaveBeenCalledTimes(1)
    expect(state.fetchIssue).toHaveBeenCalledWith('/repo', 12, { repoId: 'r1' })
  })

  it('skips GitHub calls once the user has renamed the conversation', () => {
    renderHook(() => useMadangConversationTitle(makeWorktree('내 이름'), repo))
    expect(state.fetchHostedReviewForBranch).not.toHaveBeenCalled()
    expect(state.fetchIssue).not.toHaveBeenCalled()
  })
})
