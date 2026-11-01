import React from 'react'
import type { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AutomationRun } from '../../../../shared/automations-types'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime, getUiRelativeTimeFormatter } from '@/i18n/relative-time-format'

// Reuse one formatter across run cells; per-cell construction dominates large-history rendering.
const automationDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

export function formatAutomationDateTime(value: number | null | undefined): string {
  if (!value) {
    return 'Never'
  }
  return automationDateTimeFormatter.format(value)
}

export function formatAutomationRelativeTime(
  value: number | null | undefined,
  now = Date.now()
): string | null {
  if (!value) {
    return null
  }
  const diffMs = value - now
  if (Math.abs(diffMs) < 60 * 1000) {
    return getUiRelativeTimeFormatter().format(0, 'second')
  }
  return formatUiRelativeTime(diffMs)
}

export function formatAutomationDateTimeWithRelative(
  value: number | null | undefined,
  now = Date.now()
): string {
  const absolute = formatAutomationDateTime(value)
  const relative = formatAutomationRelativeTime(value, now)
  return relative ? `${absolute} (${relative})` : absolute
}

export function getAutomationRunStatusVariant(
  status: AutomationRun['status']
): React.ComponentProps<typeof Badge>['variant'] {
  if (status === 'dispatched' || status === 'completed') {
    return 'secondary'
  }
  if (status.startsWith('skipped')) {
    return 'outline'
  }
  if (status === 'dispatch_failed') {
    return 'destructive'
  }
  return 'dot'
}

export function getAutomationRunStatusLabel(status: AutomationRun['status']): string {
  switch (status) {
    case 'pending':
      return translate('madang.state.queued', 'Queued')
    case 'dispatching':
      return translate('madang.state.starting', 'Starting')
    case 'dispatched':
      return translate('madang.state.launched', 'Launched')
    case 'completed':
      return translate('madang.state.done', 'Done')
    case 'skipped_precheck':
      return translate('madang.state.precheckSkipped', 'Precheck skipped')
    case 'skipped_missed':
      return translate('madang.state.skipped', 'Skipped')
    case 'skipped_unavailable':
      return translate('madang.state.unavailable', 'Unavailable')
    case 'skipped_needs_interactive_auth':
      return translate('madang.state.needsCredentials', 'Needs credentials')
    case 'dispatch_failed':
      return translate('madang.state.failed', 'Failed')
  }
}

export const AUTOMATION_EDITOR_SECTION_LABEL_CLASS =
  'text-[11px] font-semibold uppercase tracking-[0.05em]'

export function Field({
  label,
  children,
  className,
  labelClassName
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
  labelClassName?: string
}): React.JSX.Element {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className={cn('text-xs text-muted-foreground', labelClassName)}>{label}</div>
      {children}
    </div>
  )
}
