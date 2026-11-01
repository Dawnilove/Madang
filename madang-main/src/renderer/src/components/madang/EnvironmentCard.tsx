import { useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, FolderPlus, GitBranch, Laptop } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'

/**
 * Top card of the right sidebar: where the active task runs, which project folder it belongs to,
 * its branch, and the two ways to change that (add a project folder, start a new task).
 */
export function EnvironmentCard(): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const openModal = useAppStore((s) => s.openModal)
  const worktree = useActiveWorktree()
  const repo = useRepoById(worktree?.repoId ?? null)
  const remote = Boolean(repo?.connectionId)
  const branch = worktree?.branch?.replace(/^refs\/heads\//, '') || null
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div
      data-contextual-tour-target="madang-environment-card"
      className="m-2 rounded-lg border border-sidebar-border bg-card text-card-foreground"
    >
      <button
        type="button"
        className="flex w-full items-center gap-1 px-3 py-2 text-left text-[12px] font-semibold"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {translate('madang.environment.title', 'Environment')}
        <Chevron className="size-3.5" />
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 px-3 pb-3 text-[12px]">
          <div className="flex items-center gap-2">
            <Laptop className="size-3.5 shrink-0 text-muted-foreground" />
            <span>
              {remote
                ? translate('madang.environment.remote', 'Remote server')
                : translate('madang.environment.local', 'This computer')}
            </span>
          </div>
          <div className="flex items-center gap-2" title={repo?.path}>
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {repo?.displayName ??
                translate('madang.environment.noProject', 'No project selected')}
            </span>
          </div>
          {branch ? (
            <div className="flex items-center gap-2">
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{branch}</span>
            </div>
          ) : null}
          <div className="mt-1 flex gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent"
              onClick={() => openModal('add-repo')}
            >
              <FolderPlus className="size-3" />
              {translate('madang.environment.addProject', 'Add project folder')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent"
              onClick={() => openModal('new-workspace-composer', { telemetrySource: 'unknown' })}
            >
              <GitBranch className="size-3" />
              {translate('madang.environment.newTask', 'New task (branch)')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
