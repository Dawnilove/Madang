import { useAppStore } from '@/store'
import { selectFolderWorkspaces, selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import type { AiVaultSession, ClaudeDesktopActiveSession } from '../../../../shared/ai-vault-types'
import { findStructuredAgentSessionTab } from '@/lib/agent-session/structured-agent-session-tab-activation'
import type { Tab } from '../../../../shared/tab-types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { structuredAgentSessionTargetForTab } from '@/runtime/structured-agent-session-owner'
import { normalizeAgentSessionConversationName } from '../../../../shared/agent-session/agent-session-conversation-name'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Chat 이름은 기본이 "Claude Chat"이다. 데스크톱 세션 제목을 대화 이름으로 호스트에 저장한다(탭 이름 바꾸기와 같은 경로).
// 그러면 탭, 사이드바 줄, 세션 기록이 모두 그 이름을 읽는다.
// shortcut: waits up to ~10s for the tab and ~10s for its host; a slower launch keeps the default name.
export async function nameNewChatTab(
  worktreeId: string,
  before: Set<string>,
  title: string
): Promise<void> {
  const name = normalizeAgentSessionConversationName(title)
  if (name === null) {
    return
  }
  let tab: Tab | null = null
  for (let attempt = 0; attempt < 40 && !tab; attempt += 1) {
    tab =
      (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).find(
        (entry) => entry.contentType === 'agent-session' && !before.has(entry.id)
      ) ?? null
    if (!tab) {
      await sleep(250)
    }
  }
  if (!tab) {
    console.warn('[desktop-sync] no new chat tab to name', { worktreeId })
    return
  }
  // 탭이 막 생겼을 때는 호스트가 아직 이 대화를 모른다. 받아 줄 때까지 조용히 다시 시도한다.
  await renameChat(tab, name, 20)
}

/** Saves a chat's name on its host, the name its tab, sidebar row and Session History show. */
async function renameChat(tab: Tab, name: string, attempts: number): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const target = structuredAgentSessionTargetForTab(useAppStore.getState(), tab)
    if (!target) {
      console.warn('[desktop-sync] no host for chat tab', { tabId: tab.id })
      return
    }
    try {
      await callRuntimeRpc(target, 'agentSession.rename', {
        sessionId: tab.entityId,
        name
      })
      return
    } catch (error) {
      lastError = error
      await sleep(500)
    }
  }
  console.warn('[desktop-sync] chat rename failed', lastError)
}

/**
 * Names the chats already open for desktop sessions after their desktop titles, so a title changed in
 * the desktop app shows on its tab. Runs on the user's click, like the rest of the sync.
 */
export async function syncOpenChatNames(
  active: readonly ClaudeDesktopActiveSession[],
  sessions: readonly AiVaultSession[]
): Promise<void> {
  for (const desktop of active) {
    const name = normalizeAgentSessionConversationName(desktop.title)
    if (name === null) {
      continue
    }
    for (const tab of liveChatTabsFor(desktop.sessionId, sessions)) {
      if ((tab.customLabel ?? tab.label) !== name) {
        await renameChat(tab, name, 1)
      }
    }
  }
}

/**
 * The open chat tabs of a desktop session, in rows that still exist. A removed project leaves its tabs
 * behind in the store, out of sight; those count as closed so the session opens again where it shows.
 */
export function liveChatTabsFor(
  desktopSessionId: string,
  sessions: readonly AiVaultSession[]
): Tab[] {
  const state = useAppStore.getState()
  const liveRows = new Set([
    ...Object.values(selectWorktreesByRepo(state))
      .flat()
      .map((worktree) => worktree.id),
    ...selectFolderWorkspaces(state).map((workspace) => `folder:${workspace.id}`)
  ])
  // 같은 대화가 원본 기록과 마당 Chat 사본으로 두 번 잡힌다. Chat 사본만 탭을 가리킨다.
  return sessions.flatMap((session) => {
    const structured = session.structuredSession
    if (session.sessionId !== desktopSessionId || !structured) {
      return []
    }
    const tab = findStructuredAgentSessionTab(state.unifiedTabsByWorktree, {
      workspaceId: structured.workspaceId,
      sessionId: structured.sessionId
    })
    return tab && liveRows.has(tab.worktreeId) ? [tab] : []
  })
}
