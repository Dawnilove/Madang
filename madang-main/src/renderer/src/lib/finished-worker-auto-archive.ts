import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext
} from '../../../shared/agent-status-types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'

export const DEFAULT_FINISHED_WORKER_ARCHIVE_MINUTES = 10

export type FinishedWorkerArchiveState = {
  activeTabId: string | null
  tabsByWorktree: Record<string, readonly TerminalTab[]>
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  retainedAgentsByPaneKey: Record<string, { entry: AgentStatusEntry }>
  runtimeAgentOrchestrationByPaneKey: Record<string, AgentStatusOrchestrationContext>
}

/**
 * Terminal-view worker tabs whose dispatch completed and that showed no activity for idleMs.
 * Closing such a tab is the archive: the agent transcript stays in session history and can be resumed there.
 */
export function finishedWorkerTabsToArchive(
  state: FinishedWorkerArchiveState,
  now: number,
  idleMs: number
): string[] {
  const tabs = new Map<string, TerminalTab>()
  for (const list of Object.values(state.tabsByWorktree)) {
    for (const tab of list) {
      tabs.set(tab.id, tab)
    }
  }
  // A tab with any pane still dispatched, failed or busy is kept; one finished pane is not enough.
  const verdict = new Map<string, boolean>()
  for (const [paneKey, orchestration] of Object.entries(state.runtimeAgentOrchestrationByPaneKey)) {
    const tabId = parsePaneKey(paneKey)?.tabId
    const tab = tabId ? tabs.get(tabId) : undefined
    if (!tabId || !tab || verdict.get(tabId) === false) {
      continue
    }
    const entry =
      state.agentStatusByPaneKey[paneKey] ?? state.retainedAgentsByPaneKey[paneKey]?.entry
    const finished =
      orchestration.dispatchStatus === 'completed' &&
      tab.viewMode !== 'chat' &&
      !tab.isPinned &&
      tab.id !== state.activeTabId &&
      entry !== undefined &&
      // Why only done: blocked/waiting means the worker is asking the user something.
      entry.state === 'done' &&
      now - entry.updatedAt >= idleMs
    verdict.set(tabId, finished)
  }
  return [...verdict].filter(([, finished]) => finished).map(([tabId]) => tabId)
}
