import React, { useEffect, useMemo } from 'react'
import { FolderPlus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { selectFolderWorkspaces, selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import type { ProjectGroup } from '../../../../../shared/project-group-types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { resolveLeftSidebarStyleVariables } from '@/lib/left-sidebar-appearance'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import SidebarFilter from '@/components/sidebar/SidebarFilter'
import SidebarNav from '@/components/sidebar/SidebarNav'
import { SidebarSettingsHelpMenu } from '@/components/sidebar/SidebarSettingsHelpMenu'
import SetupScriptPromptCard from '@/components/sidebar/SetupScriptPromptCard'
import { LocalGitToolchainScanBanner } from '@/components/sidebar/LocalGitToolchainScanBanner'
import { SeveredTerminalDaemonBanner } from '@/components/sidebar/SeveredTerminalDaemonBanner'
import { StalledTerminalDaemonBanner } from '@/components/sidebar/StalledTerminalDaemonBanner'
import {
  WORKTREE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME,
  WORKTREE_SIDEBAR_RESIZE_HANDLE_LINE_CLASS_NAME
} from '@/components/sidebar/index'
import { buildConversationTree } from './conversation-tree'
import { useVisibleConversations } from './use-visible-conversations'
import { MadangConversationProject } from './MadangConversationProject'
import { MadangSidebarDialogs } from './MadangSidebarDialogs'
import { MadangWorkerRack } from './MadangWorkerRack'

// Same limits as Orca's workspace sidebar so the persisted width carries over between shells.
const MIN_WIDTH = 220
const MAX_WIDTH = 500
// A stable empty list so the selector does not rerender on every store change.
const EMPTY_PROJECT_GROUPS: readonly ProjectGroup[] = []

/** Madang's left column: projects > conversations, replacing Orca's workspace list. */
function MadangConversationSidebar(): React.JSX.Element {
  // Subscribe across this memo boundary so a language switch relabels the sidebar.
  useTranslation()
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const settings = useAppStore((s) => s.settings)
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore(selectWorktreesByRepo)
  const worktreeLineageById = useAppStore((s) => s.worktreeLineageById)
  const projectGroups = useAppStore((s) => s.projectGroups ?? EMPTY_PROJECT_GROUPS)
  const folderWorkspaces = useAppStore(selectFolderWorkspaces)
  const openModal = useAppStore((s) => s.openModal)
  const systemPrefersDark = useSystemPrefersDark()
  const leftSidebarStyle = useMemo(
    () => resolveLeftSidebarStyleVariables(settings, systemPrefersDark),
    [settings, systemPrefersDark]
  ) as React.CSSProperties | undefined

  const startupWorktreeRefreshCompleted = useAppStore((s) => s.startupWorktreeRefreshCompleted)
  const fetchAllWorktrees = useAppStore((s) => s.fetchAllWorktrees)
  const repoCount = repos.length
  const previousRepoCountRef = React.useRef(repoCount)
  useEffect(() => {
    const repoCountChanged = previousRepoCountRef.current !== repoCount
    previousRepoCountRef.current = repoCount
    // Why: Orca's Sidebar owns this scan after a project is added or removed; this shell replaces
    // that Sidebar, so without it a new project shows no conversations until restart.
    if (startupWorktreeRefreshCompleted && repoCountChanged && repoCount > 0) {
      void fetchAllWorktrees()
    }
  }, [repoCount, startupWorktreeRefreshCompleted, fetchAllWorktrees])

  const { visibleHostIdentities, filterRepoIds } = useVisibleConversations()
  const projects = useMemo(
    () =>
      buildConversationTree(
        repos,
        worktreesByRepo,
        worktreeLineageById,
        { visibleHostIdentities, filterRepoIds },
        { projectGroups, workspaces: folderWorkspaces }
      ),
    [
      repos,
      worktreesByRepo,
      worktreeLineageById,
      visibleHostIdentities,
      filterRepoIds,
      projectGroups,
      folderWorkspaces
    ]
  )

  const setLiveSidebarWidth = React.useCallback((width: number) => {
    document.documentElement.style.setProperty('--workspace-sidebar-live-width', `${width}px`)
  }, [])
  const { containerRef, onResizeStart, isResizing } = useSidebarResize<HTMLDivElement>({
    isOpen: sidebarOpen,
    width: sidebarWidth,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    deltaSign: 1,
    setWidth: setSidebarWidth,
    onDraftWidthChange: setLiveSidebarWidth
  })

  return (
    <TooltipProvider delayDuration={400}>
      <div
        ref={containerRef}
        data-madang-conversation-sidebar=""
        className="relative min-h-0 flex-shrink-0 bg-worktree-sidebar flex flex-col overflow-hidden scrollbar-sleek-parent"
        style={leftSidebarStyle}
      >
        {sidebarOpen ? (
          <>
            {/* Orca's page buttons (tasks, automations, skills) keep their own show/hide settings. */}
            <SidebarNav />
            <div className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-1">
              <Button
                type="button"
                size="sm"
                className="flex-1 justify-start"
                onClick={() =>
                  openModal('new-workspace-composer', {
                    telemetrySource: 'unknown'
                  })
                }
              >
                <Plus className="size-3.5" />
                {translate('madang.shell.newConversation', 'New conversation')}
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={translate('madang.shell.addProject', 'Add project')}
                title={translate('madang.shell.addProject', 'Add project')}
                onClick={() => openModal('add-repo')}
              >
                <FolderPlus className="size-4" />
              </Button>
              {/* Orca's own filter menu: the visible list already follows these filters (use-visible-conversations). */}
              <SidebarFilter />
            </div>
            {/* Why: keep Orca's sidebar warnings; they are the only place these failures surface. */}
            <SeveredTerminalDaemonBanner />
            <StalledTerminalDaemonBanner />
            <LocalGitToolchainScanBanner />
            <div
              data-worktree-sidebar=""
              role="listbox"
              aria-label={translate('madang.shell.conversations', 'Conversations')}
              className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 scrollbar-sleek"
            >
              {projects.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  {translate('madang.shell.noProjects', 'Add a project to start a conversation.')}
                </p>
              ) : (
                projects.map((project) => (
                  <MadangConversationProject
                    key={project.repo?.id ?? `group:${project.group?.id}`}
                    project={project}
                  />
                ))
              )}
            </div>
            <SetupScriptPromptCard />
            <MadangWorkerRack />
            <div className="mt-auto flex shrink-0 items-center border-t border-worktree-sidebar-border px-2 py-1.5">
              <SidebarSettingsHelpMenu />
            </div>
            <div
              data-sidebar-resize-handle=""
              className={cn(WORKTREE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME, isResizing && 'bg-ring/10')}
              onMouseDown={onResizeStart}
            >
              <div
                className={cn(
                  WORKTREE_SIDEBAR_RESIZE_HANDLE_LINE_CLASS_NAME,
                  isResizing && 'bg-ring'
                )}
              />
            </div>
          </>
        ) : null}
      </div>
      <MadangSidebarDialogs />
    </TooltipProvider>
  )
}

export default React.memo(MadangConversationSidebar)
