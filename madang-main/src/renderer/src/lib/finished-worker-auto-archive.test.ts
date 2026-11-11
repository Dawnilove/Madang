import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import {
  finishedWorkerTabsToArchive,
  type FinishedWorkerArchiveState
} from './finished-worker-auto-archive'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'
const IDLE = 10 * 60 * 1000
const NOW = 100 * 60 * 1000

function tab(id: string, extra: Partial<TerminalTab> = {}): TerminalTab {
  return { id, ...extra } as TerminalTab
}

function entry(state: AgentStatusEntry['state'], updatedAt: number): AgentStatusEntry {
  return { state, updatedAt } as AgentStatusEntry
}

function base(): FinishedWorkerArchiveState {
  return {
    activeTabId: 'lead',
    tabsByWorktree: { w1: [tab('lead'), tab('worker')] },
    agentStatusByPaneKey: { [`worker:${LEAF_A}`]: entry('done', NOW - IDLE) },
    retainedAgentsByPaneKey: {},
    runtimeAgentOrchestrationByPaneKey: {
      [`worker:${LEAF_A}`]: {
        taskId: 't',
        dispatchId: 'd',
        dispatchStatus: 'completed'
      }
    }
  }
}

describe('finishedWorkerTabsToArchive', () => {
  it('archives a completed, idle terminal worker', () => {
    expect(finishedWorkerTabsToArchive(base(), NOW, IDLE)).toEqual(['worker'])
  })

  it('keeps a worker that was active within the idle time', () => {
    const state = base()
    state.agentStatusByPaneKey[`worker:${LEAF_A}`] = entry('done', NOW - IDLE + 1)
    expect(finishedWorkerTabsToArchive(state, NOW, IDLE)).toEqual([])
  })

  it.each([
    [
      'still dispatched',
      (s: FinishedWorkerArchiveState) => {
        s.runtimeAgentOrchestrationByPaneKey[`worker:${LEAF_A}`]!.dispatchStatus = 'dispatched'
      }
    ],
    [
      'waiting for the user',
      (s: FinishedWorkerArchiveState) => {
        s.agentStatusByPaneKey[`worker:${LEAF_A}`] = entry('waiting', 0)
      }
    ],
    [
      'shown as chat',
      (s: FinishedWorkerArchiveState) => {
        s.tabsByWorktree = { w1: [tab('worker', { viewMode: 'chat' })] }
      }
    ],
    [
      'pinned',
      (s: FinishedWorkerArchiveState) => {
        s.tabsByWorktree = { w1: [tab('worker', { isPinned: true })] }
      }
    ],
    [
      'the active tab',
      (s: FinishedWorkerArchiveState) => {
        s.activeTabId = 'worker'
      }
    ],
    [
      'without any status',
      (s: FinishedWorkerArchiveState) => {
        s.agentStatusByPaneKey = {}
      }
    ]
  ])('keeps a worker %s', (_name, change) => {
    const state = base()
    change(state)
    expect(finishedWorkerTabsToArchive(state, NOW, IDLE)).toEqual([])
  })

  it('keeps a split tab while another worker pane in it is still running', () => {
    const state = base()
    state.agentStatusByPaneKey[`worker:${LEAF_B}`] = entry('working', NOW)
    state.runtimeAgentOrchestrationByPaneKey[`worker:${LEAF_B}`] = {
      taskId: 't2',
      dispatchId: 'd2',
      dispatchStatus: 'dispatched'
    }
    expect(finishedWorkerTabsToArchive(state, NOW, IDLE)).toEqual([])
  })

  it('uses the retained status once the live row is gone', () => {
    const state = base()
    state.retainedAgentsByPaneKey = {
      [`worker:${LEAF_A}`]: { entry: entry('done', NOW - IDLE) }
    }
    state.agentStatusByPaneKey = {}
    expect(finishedWorkerTabsToArchive(state, NOW, IDLE)).toEqual(['worker'])
  })
})
