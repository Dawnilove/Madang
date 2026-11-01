import React from 'react'
import { useAppStore } from '@/store'
import { lazyWithRetry } from '@/lib/lazy-with-retry'

// Why: Orca's Sidebar hosts these modals. Other surfaces (command palette, workspace menus) can
// still open them, so the Madang sidebar must host the same set or those actions would do nothing.
const WorktreeMetaDialog = lazyWithRetry(() => import('@/components/sidebar/WorktreeMetaDialog'))
const RemoveFolderDialog = lazyWithRetry(() => import('@/components/sidebar/RemoveFolderDialog'))
const SleepTwinWorkspaceDialog = lazyWithRetry(
  () => import('@/components/sidebar/SleepTwinWorkspaceDialog')
)
const WorktreeVisibilityDialog = lazyWithRetry(
  () => import('@/components/sidebar/WorktreeVisibilityDialog')
)
const OrcaYamlTrustDialog = lazyWithRetry(() => import('@/components/sidebar/OrcaYamlTrustDialog'))
const ForgetSshWorkspaceDialog = lazyWithRetry(
  () => import('@/components/sidebar/ForgetSshWorkspaceDialog')
)

export function MadangSidebarDialogs(): React.JSX.Element {
  const activeModal = useAppStore((s) => s.activeModal)
  return (
    <React.Suspense fallback={null}>
      {activeModal === 'edit-meta' ? <WorktreeMetaDialog /> : null}
      {activeModal === 'confirm-remove-folder' ? <RemoveFolderDialog /> : null}
      {activeModal === 'confirm-sleep-twin' ? <SleepTwinWorkspaceDialog /> : null}
      {activeModal === 'worktree-visibility' ? <WorktreeVisibilityDialog /> : null}
      {activeModal === 'confirm-orca-yaml-hooks' ? <OrcaYamlTrustDialog /> : null}
      {activeModal === 'forget-ssh-workspace' ? <ForgetSshWorkspaceDialog /> : null}
    </React.Suspense>
  )
}
