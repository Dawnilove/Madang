import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SearchableSetting } from './SearchableSetting'

type UsageOptInKey = 'claudeUsageEnabled' | 'codexUsageEnabled'

export function UsageOptInSwitch({
  settingKey,
  provider,
  settings,
  updateSettings
}: {
  settingKey: UsageOptInKey
  provider: 'Claude' | 'Codex'
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const label = translate('settings.usageOptIn.label', 'Show {{value0}} usage', {
    value0: provider
  })
  const warning = translate(
    'settings.usageOptIn.warning',
    'Reads your saved login token to look up usage. This may violate the provider’s terms.'
  )
  return (
    <SearchableSetting
      title={label}
      description={warning}
      keywords={[provider.toLowerCase(), 'usage', 'rate limit', 'token', 'status bar']}
      className="flex items-center justify-between gap-4 py-2"
    >
      <div className="space-y-0.5">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{warning}</p>
      </div>
      <Switch
        aria-label={label}
        checked={settings[settingKey]}
        onCheckedChange={(checked) => {
          // Turning off is always safe; turning on needs an explicit confirmation.
          if (checked) {
            setConfirmOpen(true)
          } else {
            updateSettings({ [settingKey]: false })
          }
        }}
      />
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {translate('settings.usageOptIn.confirmTitle', 'Turn on {{value0}} usage?', {
                value0: provider
              })}
            </DialogTitle>
            <DialogDescription>{warning}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              {translate('settings.usageOptIn.cancel', 'Cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                updateSettings({ [settingKey]: true })
                setConfirmOpen(false)
              }}
            >
              {translate('settings.usageOptIn.confirm', 'Turn on')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SearchableSetting>
  )
}
