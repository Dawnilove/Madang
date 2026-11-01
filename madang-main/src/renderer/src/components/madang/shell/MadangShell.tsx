import { AppWorkspaceShell } from '@/app-shell/AppWorkspaceShell'
import type { AppChromeLayout } from '@/app-shell/use-app-chrome-layout'
import type { FloatingWorkspacePanelState } from '@/app-shell/use-floating-workspace-panel'
import MadangConversationSidebar from './MadangConversationSidebar'
import { useMadangIntroTour } from '../madang-intro-tour'

/**
 * Madang's chat-centered shell (stage 2, first version). It keeps Orca's frame (titlebar, workbench
 * with the chat tab, pages, right sidebar) and swaps the left workspace list for the conversation
 * list. Why: reusing the frame keeps settings, landing, command palette and every workbench surface
 * working while the layout moves toward chat; later stages replace parts one at a time.
 */
export function MadangShell(props: {
  layout: AppChromeLayout
  floatingWorkspace: FloatingWorkspacePanelState
}): React.JSX.Element {
  useMadangIntroTour()
  return (
    <AppWorkspaceShell
      layout={props.layout}
      floatingWorkspace={props.floatingWorkspace}
      leftSidebar={<MadangConversationSidebar />}
    />
  )
}
