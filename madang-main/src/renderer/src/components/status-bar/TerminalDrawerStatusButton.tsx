import React from 'react'
import { SquareTerminal } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toggleTerminalDrawer } from '@/lib/terminal-drawer'
import { translate } from '@/i18n/i18n'

export function TerminalDrawerStatusButton(): React.JSX.Element {
  const label = translate('madang.terminalDrawer.toggle', 'Terminal drawer (Ctrl+`)')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-5 cursor-pointer items-center justify-center rounded border border-border bg-secondary text-secondary-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={label}
          onClick={() => toggleTerminalDrawer()}
        >
          <SquareTerminal className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
