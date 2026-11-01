import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { isMacAppDataPath } from '@/lib/passive-macos-app-data-access'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { isWebClient } from '@/components/sidebar/worktree-card-model'
import { useWorktreeCardLinkedDetails } from '@/components/sidebar/use-worktree-card-linked-details'
import { useWorktreeCardReviewDetails } from '@/components/sidebar/use-worktree-card-review-details'

/**
 * Title of a conversation row. A name the user set wins; while the name is still the branch name,
 * the linked issue or review title replaces it (same rule as Orca's workspace card).
 */
export function useMadangConversationTitle(worktree: Worktree, repo: Repo | undefined): string {
  const settings = useAppStore((s) => s.settings)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const cardProps = useAppStore((s) => s.worktreeCardProperties)
  const fetchHostedReviewForBranch = useAppStore((s) => s.fetchHostedReviewForBranch)
  const fetchIssue = useAppStore((s) => s.fetchIssue)
  const fetchLinearIssue = useAppStore((s) => s.fetchLinearIssue)

  const review = useWorktreeCardReviewDetails({
    worktree,
    repo,
    settings,
    projectGroups,
    cardProps,
    newCardStyle: true
  })
  const linked = useWorktreeCardLinkedDetails({
    worktree,
    newCardStyle: true,
    deleteState: undefined,
    branch: review.branch,
    issueEntry: review.issueEntry,
    linearIssueEntry: review.linearIssueEntry,
    linearIssueFallbackEntry: review.linearIssueFallbackEntry,
    prDisplay: review.prDisplay
  })

  // Why: the title only changes while the name equals the branch, so other rows never call GitHub.
  const titleCanChange =
    review.branch.length > 0 && worktree.displayName.trim() === review.branch.trim()
  const canFetch =
    titleCanChange &&
    !isWebClient() &&
    !!repo &&
    !review.isFolder &&
    !worktree.isBare &&
    !isMacAppDataPath(repo.path)

  // Why: one lookup per row; the store dedupes in-flight calls and skips fresh cache entries.
  useEffect(() => {
    if (!canFetch || !repo || !review.hostedReviewCacheKey) {
      return
    }
    void fetchHostedReviewForBranch(repo.path, review.branch, {
      repoId: repo.id,
      repoOwnerExecutionHostId: getRepoExecutionHostId(repo),
      linkedGitHubPR: worktree.linkedPR ?? null,
      currentHeadOid: worktree.head ?? null,
      linkedGitLabMR: review.linkedGitLabMR,
      linkedBitbucketPR: review.linkedBitbucketPR,
      linkedAzureDevOpsPR: review.linkedAzureDevOpsPR,
      linkedGiteaPR: review.linkedGiteaPR,
      staleWhileRevalidate: true
    })
  }, [
    canFetch,
    repo,
    review.branch,
    review.hostedReviewCacheKey,
    review.linkedGitLabMR,
    review.linkedBitbucketPR,
    review.linkedAzureDevOpsPR,
    review.linkedGiteaPR,
    worktree.linkedPR,
    worktree.head,
    fetchHostedReviewForBranch
  ])

  useEffect(() => {
    if (canFetch && repo && worktree.linkedIssue && review.issueCacheKey) {
      void fetchIssue(repo.path, worktree.linkedIssue, { repoId: repo.id })
    }
  }, [canFetch, repo, worktree.linkedIssue, review.issueCacheKey, fetchIssue])

  useEffect(() => {
    if (canFetch && worktree.linkedLinearIssue) {
      void fetchLinearIssue(worktree.linkedLinearIssue, review.linearWorkspaceId, {
        sourceContext: review.linearSourceContext
      })
    }
  }, [
    canFetch,
    worktree.linkedLinearIssue,
    review.linearWorkspaceId,
    review.linearSourceContext,
    fetchLinearIssue
  ])

  return linked.visibleCardTitle
}
