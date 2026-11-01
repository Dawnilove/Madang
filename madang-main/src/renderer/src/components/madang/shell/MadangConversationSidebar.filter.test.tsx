// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  sidebarOpen: true,
  sidebarWidth: 280,
  setSidebarWidth: vi.fn(),
  settings: {},
  repos: [],
  worktreeLineageById: {},
  openModal: vi.fn(),
  startupWorktreeRefreshCompleted: true,
  fetchAllWorktrees: vi.fn()
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({}) }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (value: typeof state) => unknown) => selector(state)
}))
vi.mock('@/store/workspace-record-selectors', () => ({
  selectWorktreesByRepo: () => ({}),
  selectFolderWorkspaces: () => []
}))
vi.mock('@/hooks/useSidebarResize', () => ({
  useSidebarResize: () => ({
    containerRef: { current: null },
    onResizeStart: vi.fn(),
    isResizing: false
  })
}))
vi.mock('@/lib/left-sidebar-appearance', () => ({ resolveLeftSidebarStyleVariables: () => ({}) }))
vi.mock('@/components/terminal-pane/use-system-prefers-dark', () => ({
  useSystemPrefersDark: () => false
}))
vi.mock('@/components/sidebar/SidebarFilter', () => ({
  default: () => <button type="button" data-testid="sidebar-filter" />
}))
vi.mock('@/components/sidebar/SidebarNav', () => ({ default: () => null }))
vi.mock('@/components/sidebar/SidebarSettingsHelpMenu', () => ({
  SidebarSettingsHelpMenu: () => null
}))
vi.mock('@/components/sidebar/SetupScriptPromptCard', () => ({
  default: () => <div data-testid="setup-script-card" />
}))
vi.mock('@/components/sidebar/LocalGitToolchainScanBanner', () => ({
  LocalGitToolchainScanBanner: () => null
}))
vi.mock('@/components/sidebar/SeveredTerminalDaemonBanner', () => ({
  SeveredTerminalDaemonBanner: () => null
}))
vi.mock('@/components/sidebar/StalledTerminalDaemonBanner', () => ({
  StalledTerminalDaemonBanner: () => null
}))
vi.mock('@/components/sidebar/index', () => ({
  WORKTREE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME: '',
  WORKTREE_SIDEBAR_RESIZE_HANDLE_LINE_CLASS_NAME: ''
}))
vi.mock('./use-visible-conversations', () => ({
  useVisibleConversations: () => ({ visibleHostIdentities: undefined, filterRepoIds: undefined })
}))
vi.mock('./MadangConversationProject', () => ({ MadangConversationProject: () => null }))
vi.mock('./MadangSidebarDialogs', () => ({ MadangSidebarDialogs: () => null }))

import MadangConversationSidebar from './MadangConversationSidebar'

afterEach(cleanup)

describe('MadangConversationSidebar setup card', () => {
  it('mounts Orca’s setup-script prompt card under the conversation list', () => {
    const { getByTestId, getByRole } = render(<MadangConversationSidebar />)
    const list = getByRole('listbox')
    const card = getByTestId('setup-script-card')
    expect(list.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('MadangConversationSidebar filter', () => {
  it('puts Orca’s filter menu in the action row after the add-project button', () => {
    const { getByTestId, getByLabelText } = render(<MadangConversationSidebar />)
    const addProject = getByLabelText('Add project')
    const filter = getByTestId('sidebar-filter')
    expect(addProject.parentElement).toBe(filter.parentElement)
    expect(
      addProject.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
