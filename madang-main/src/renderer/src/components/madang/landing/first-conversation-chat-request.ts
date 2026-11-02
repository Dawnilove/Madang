import { buildQuickCreationRequest } from '@/hooks/composer-state/quick-creation-request'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { buildConversationDisplayName, buildConversationName } from './first-conversation'

/**
 * The first-screen box starts a chat: the creation flow opens the chat as the workspace's first tab,
 * so no idle shell is seeded before it (creating first and launching afterwards left a terminal in front).
 */
export function buildFirstConversationChatRequest(input: {
  repoId: string
  agent: TuiAgent
  text: string
  now: Date
  suffix: string
}): WorktreeCreationRequest {
  const text = input.text.trim()
  return buildQuickCreationRequest({
    repoId: input.repoId,
    ephemeralVmRecipe: undefined,
    indeterminateProgress: false,
    taskSourceContext: null,
    linkedWorkItem: null,
    workspaceRunContext: undefined,
    workspaceName: buildConversationName(input.now, input.suffix),
    nameWasGenerated: false,
    displayName: buildConversationDisplayName(text),
    displayNameKind: 'user',
    selectedRepoIsGit: true,
    baseBranch: undefined,
    compareBaseRef: undefined,
    setupDecision: 'inherit',
    sparseDirectories: null,
    sparsePresetId: null,
    telemetrySource: 'unknown',
    linkedIssue: null,
    linkedPR: null,
    pushTarget: undefined,
    agent: input.agent,
    agentLaunchRoute: 'structured-native-chat',
    linkedLinearIssue: undefined,
    linkedLinearIssueWorkspaceId: undefined,
    linkedLinearIssueOrganizationUrlKey: undefined,
    branchNameOverride: undefined,
    parentWorktreeId: null,
    workspaceStatus: undefined,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    includeGitLabLinks: false,
    startup: undefined,
    pendingFirstAgentMessageRename: false,
    note: '',
    startupPlan: null,
    quickPrompt: text,
    launchDraftPrompt: undefined,
    promptDelivery: 'auto-submit',
    quickTelemetry: null,
    suppressTerminalFocusOnCompletion: false,
    setupOnly: false
  })
}
