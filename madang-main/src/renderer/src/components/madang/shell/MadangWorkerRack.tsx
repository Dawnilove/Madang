import React, { useMemo } from 'react'
import { Server } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { revealTerminalPane } from '@/lib/reveal-terminal-pane'
import StatusIndicator from '@/components/sidebar/StatusIndicator'
import { formatAgentTypeLabel } from '../../../../../shared/agent-type-label'
import { buildWorkerRack, type WorkerRackUnit } from './worker-rack'

function RackUnit({ unit }: { unit: WorkerRackUnit }): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        data-worker-rack-unit={unit.paneKey}
        className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-sm border border-border/60 bg-background/60 px-1.5 text-left text-[11px] hover:bg-worktree-sidebar-accent/60"
        onClick={() =>
          revealTerminalPane({
            worktreeId: unit.worktreeId,
            tabId: unit.tabId,
            leafId: unit.leafId,
            executionHostId: null
          })
        }
      >
        {/* Rack screws: decoration only. */}
        <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-muted-foreground/40" />
        <StatusIndicator status={unit.status} tooltipSide="right" />
        <span className="min-w-0 flex-1 truncate">{unit.name}</span>
        {unit.agentType ? (
          <span className="shrink-0 text-muted-foreground">
            {formatAgentTypeLabel(unit.agentType)}
          </span>
        ) : null}
        <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
          {translate('madang.shell.workerRack.terminal', 'Terminal')}
        </span>
        <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-muted-foreground/40" />
      </button>
    </li>
  )
}

/** Terminal workers that took a role from a lead, stacked like servers at the sidebar bottom. */
export function MadangWorkerRack(): React.JSX.Element | null {
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const retainedAgentsByPaneKey = useAppStore((s) => s.retainedAgentsByPaneKey)
  const runtimeAgentOrchestrationByPaneKey = useAppStore(
    (s) => s.runtimeAgentOrchestrationByPaneKey
  )
  const units = useMemo(
    () =>
      buildWorkerRack({
        tabsByWorktree,
        agentStatusByPaneKey,
        retainedAgentsByPaneKey,
        runtimeAgentOrchestrationByPaneKey
      }),
    [
      tabsByWorktree,
      agentStatusByPaneKey,
      retainedAgentsByPaneKey,
      runtimeAgentOrchestrationByPaneKey
    ]
  )
  if (units.length === 0) {
    return null
  }
  const label = translate('madang.shell.workerRack.title', 'Worker rack')
  return (
    <section
      aria-label={label}
      className="shrink-0 border-t border-worktree-sidebar-border px-2 pb-1.5 pt-1"
    >
      <div className="flex items-center gap-1.5 pb-1 text-[11px] text-muted-foreground">
        <Server className="size-3.5" aria-hidden="true" />
        <span className="flex-1">{label}</span>
        <span>{units.length}</span>
      </div>
      <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-1 scrollbar-sleek">
        {units.map((unit) => (
          <RackUnit key={unit.paneKey} unit={unit} />
        ))}
      </ul>
    </section>
  )
}
