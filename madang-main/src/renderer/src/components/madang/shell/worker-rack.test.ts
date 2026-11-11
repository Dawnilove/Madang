import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { buildWorkerRack, type WorkerRackState } from './worker-rack'

const LEAF = '11111111-1111-4111-8111-111111111111'
const KEY = `worker:${LEAF}`

function tab(extra: Partial<TerminalTab> = {}): TerminalTab {
  return { id: 'worker', title: 'Terminal 2', customTitle: null, ...extra } as TerminalTab
}

function entry(state: AgentStatusEntry['state']): AgentStatusEntry {
  return { state, updatedAt: 0, agentType: 'codex' } as AgentStatusEntry
}

function base(): WorkerRackState {
  return {
    tabsByWorktree: { w1: [{ id: 'lead' } as TerminalTab, tab()] },
    agentStatusByPaneKey: { [KEY]: entry('working') },
    retainedAgentsByPaneKey: {},
    runtimeAgentOrchestrationByPaneKey: {
      [KEY]: { taskId: 't', dispatchId: 'd', dispatchStatus: 'dispatched', displayName: '구현' }
    }
  }
}

describe('buildWorkerRack', () => {
  it('stacks a terminal worker with its role name, agent and status', () => {
    expect(buildWorkerRack(base())).toEqual([
      {
        paneKey: KEY,
        worktreeId: 'w1',
        tabId: 'worker',
        leafId: LEAF,
        name: '구현',
        agentType: 'codex',
        kind: 'terminal',
        status: 'working'
      }
    ])
  })

  it('leaves out chat workers and closed tabs', () => {
    const chat = base()
    chat.tabsByWorktree = { w1: [tab({ viewMode: 'chat' })] }
    expect(buildWorkerRack(chat)).toEqual([])

    const closed = base()
    closed.tabsByWorktree = { w1: [] }
    expect(buildWorkerRack(closed)).toEqual([])
  })

  it.each([
    ['waiting', 'dispatched', 'permission'],
    ['done', 'dispatched', 'done'],
    ['working', 'failed', 'failed'],
    [undefined, 'completed', 'done'],
    [undefined, 'dispatched', 'inactive']
  ] as const)('shows state %s with dispatch %s as %s', (state, dispatchStatus, status) => {
    const s = base()
    s.agentStatusByPaneKey = state ? { [KEY]: entry(state) } : {}
    s.runtimeAgentOrchestrationByPaneKey[KEY]!.dispatchStatus = dispatchStatus
    expect(buildWorkerRack(s)[0]?.status).toBe(status)
  })

  it('falls back to the tab title when the dispatch has no name', () => {
    const s = base()
    delete s.runtimeAgentOrchestrationByPaneKey[KEY]!.displayName
    expect(buildWorkerRack(s)[0]?.name).toBe('Terminal 2')
  })
})
