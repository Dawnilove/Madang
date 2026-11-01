import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { DesktopSyncPlan } from './ai-vault-desktop-sync-plan'
import { DESKTOP_ACTIVE_OPEN_LIMIT } from './ai-vault-open-desktop-active'

/** Lists the sessions a sync would add, grouped as the desktop app groups them, and lets the user pick. */
export function AiVaultDesktopSyncDialog({
  plan,
  onConfirm,
  onCancel
}: {
  plan: DesktopSyncPlan
  onConfirm: (sessionIds: ReadonlySet<string>) => void
  onCancel: () => void
}): React.JSX.Element {
  // Each added session opens its own agent, so cap it like "open active" does.
  const [selected, setSelected] = useState(
    () =>
      new Set(plan.items.slice(0, DESKTOP_ACTIVE_OPEN_LIMIT).map((item) => item.session.sessionId))
  )
  const overLimit = selected.size > DESKTOP_ACTIVE_OPEN_LIMIT
  const toggle = (ids: readonly string[], on: boolean): void =>
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (on) {
          next.add(id)
        } else {
          next.delete(id)
        }
      }
      return next
    })
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="min-w-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('madang.aiVault.syncDesktop.title', 'Open Claude desktop sessions')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'madang.aiVault.syncDesktop.description',
              'Pick sessions to open as tabs in their project. Nothing is deleted.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-3 scrollbar-sleek overflow-y-auto pr-1 text-sm">
          {plan.groups.map((group) => {
            const items = plan.items.filter((item) => item.groupKey === group.key)
            const ids = items.map((item) => item.session.sessionId)
            const checkedCount = ids.filter((id) => selected.has(id)).length
            return (
              <div key={group.key}>
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox
                    checked={
                      checkedCount === ids.length
                        ? true
                        : checkedCount === 0
                          ? false
                          : 'indeterminate'
                    }
                    onCheckedChange={(on) => toggle(ids, on === true)}
                  />
                  <span className="truncate">{group.label}</span>
                </label>
                <div className="mt-1 space-y-1 pl-6">
                  {items.map((item) => (
                    <label key={item.session.sessionId} className="flex items-center gap-2">
                      <Checkbox
                        checked={selected.has(item.session.sessionId)}
                        onCheckedChange={(on) => toggle([item.session.sessionId], on === true)}
                      />
                      <span className="min-w-0 truncate">{item.session.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        {plan.items.length > DESKTOP_ACTIVE_OPEN_LIMIT ? (
          <p className={overLimit ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {translate(
              'madang.aiVault.syncDesktop.limit',
              'Opens up to {{limit}} at a time. Run it again for the rest.',
              { limit: DESKTOP_ACTIVE_OPEN_LIMIT }
            )}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {translate('madang.aiVault.syncDesktop.cancel', 'Cancel')}
          </Button>
          <Button disabled={selected.size === 0 || overLimit} onClick={() => onConfirm(selected)}>
            {translate('madang.aiVault.syncDesktop.add', 'Open {{count}} sessions', {
              count: selected.size
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
