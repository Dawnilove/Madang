import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTabsSliceMockApi } from '@/store/slices/tabs-slice-test-harness'
import { createTestStore } from '@/store/slices/store-test-helpers'
import {
  TERMINAL_DRAWER_COLLAPSED_RATIO,
  TERMINAL_DRAWER_OPEN_RATIO,
  findDrawerSplit,
  resetTerminalDrawerForTests,
  toggleTerminalDrawer
} from './terminal-drawer'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
createTabsSliceMockApi()
import type { TabGroupLayoutNode } from '../../../shared/tab-types'

describe('findDrawerSplit', () => {
  const leaf = (groupId: string): TabGroupLayoutNode => ({ type: 'leaf', groupId })

  it('finds the vertical split whose bottom child is the group', () => {
    const layout: TabGroupLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      first: leaf('a'),
      second: {
        type: 'split',
        direction: 'vertical',
        first: leaf('b'),
        second: leaf('d'),
        ratio: 0.7
      }
    }
    expect(findDrawerSplit(layout, 'd')).toEqual({ path: ['second'], ratio: 0.7 })
  })

  it('ignores groups that sit in the top or in a horizontal split', () => {
    const layout: TabGroupLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      first: leaf('a'),
      second: leaf('d')
    }
    expect(findDrawerSplit(layout, 'd')).toBeNull()
    expect(findDrawerSplit(leaf('d'), 'd')).toBeNull()
  })

  it('defaults the ratio to 0.5', () => {
    const layout: TabGroupLayoutNode = {
      type: 'split',
      direction: 'vertical',
      first: leaf('a'),
      second: leaf('d')
    }
    expect(findDrawerSplit(layout, 'd')).toEqual({ path: [], ratio: 0.5 })
  })
})

describe('toggleTerminalDrawer', () => {
  const WT = 'repo1::/tmp/feature'
  let store: ReturnType<typeof createTestStore>

  beforeEach(() => {
    resetTerminalDrawerForTests()
    store = createTestStore()
    store.getState().createTab(WT)
    store.setState({ activeWorktreeId: WT })
  })

  const ratioOfBottom = (): number | undefined => {
    const layout = store.getState().layoutByWorktree[WT]
    const group = store.getState().activeGroupIdByWorktree[WT]
    return layout && group ? findDrawerSplit(layout, group)?.ratio : undefined
  }

  it('opens a bottom terminal group, folds it, then unfolds it to the last ratio', () => {
    toggleTerminalDrawer(store)
    expect(store.getState().groupsByWorktree[WT]).toHaveLength(2)
    expect(ratioOfBottom()).toBe(TERMINAL_DRAWER_OPEN_RATIO)

    toggleTerminalDrawer(store)
    expect(ratioOfBottom()).toBe(TERMINAL_DRAWER_COLLAPSED_RATIO)

    toggleTerminalDrawer(store)
    expect(ratioOfBottom()).toBe(TERMINAL_DRAWER_OPEN_RATIO)
    expect(store.getState().groupsByWorktree[WT]).toHaveLength(2)
  })

  it('does nothing without an active workspace', () => {
    store.setState({ activeWorktreeId: null })
    toggleTerminalDrawer(store)
    expect(store.getState().groupsByWorktree[WT]).toHaveLength(1)
  })
})
