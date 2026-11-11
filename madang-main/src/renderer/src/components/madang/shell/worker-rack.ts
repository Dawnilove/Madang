import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext,
  AgentType
} from '../../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import type { WorktreeStatus } from '@/lib/worktree-status'

/** One rack slot: a worker that got a role from a lead and runs as a terminal. */
export type WorkerRackUnit = {
  paneKey: string
  worktreeId: string
  tabId: string
  leafId: string
  name: string
  agentType?: AgentType
  /** Only 'terminal' for now; chat workers already show as chats. */
  kind: 'terminal'
  status: WorktreeStatus
}

export type WorkerRackState = {
  tabsByWorktree: Record<string, readonly TerminalTab[]>
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  retainedAgentsByPaneKey: Record<string, { entry: AgentStatusEntry }>
  runtimeAgentOrchestrationByPaneKey: Record<string, AgentStatusOrchestrationContext>
}

function unitStatus(
  orchestration: AgentStatusOrchestrationContext,
  entry: AgentStatusEntry | undefined
): WorktreeStatus {
  if (
    orchestration.dispatchStatus === 'failed' ||
    orchestration.dispatchStatus === 'circuit_broken'
  ) {
    return 'failed'
  }
  if (entry?.state === 'working') {
    return 'working'
  }
  if (entry?.state === 'blocked' || entry?.state === 'waiting') {
    return 'permission'
  }
  if (entry?.state === 'done' || orchestration.dispatchStatus === 'completed') {
    return 'done'
  }
  return 'inactive'
}

export function buildWorkerRack(state: WorkerRackState): WorkerRackUnit[] {
  const tabs = new Map<string, { tab: TerminalTab; worktreeId: string }>()
  for (const [worktreeId, list] of Object.entries(state.tabsByWorktree)) {
    for (const tab of list) {
      tabs.set(tab.id, { tab, worktreeId })
    }
  }
  const units: WorkerRackUnit[] = []
  for (const [paneKey, orchestration] of Object.entries(state.runtimeAgentOrchestrationByPaneKey)) {
    const parsed = parsePaneKey(paneKey)
    const owner = parsed ? tabs.get(parsed.tabId) : undefined
    // A closed (archived) tab leaves the rack; a chat worker is not a terminal unit.
    if (!parsed || !owner || owner.tab.viewMode === 'chat') {
      continue
    }
    const entry =
      state.agentStatusByPaneKey[paneKey] ?? state.retainedAgentsByPaneKey[paneKey]?.entry
    units.push({
      paneKey,
      worktreeId: owner.worktreeId,
      tabId: parsed.tabId,
      leafId: parsed.leafId,
      name:
        orchestration.displayName?.trim() ||
        orchestration.taskTitle?.trim() ||
        owner.tab.customTitle?.trim() ||
        owner.tab.title,
      ...(entry?.agentType ? { agentType: entry.agentType } : {}),
      kind: 'terminal',
      status: unitStatus(orchestration, entry)
    })
  }
  return units
}
