import { useState } from 'react'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  normalizeSessionRetentionDays,
  SESSION_RETENTION_DAY_OPTIONS
} from '../../../../shared/session-retention-settings'
import { SettingsRow } from './SettingsFormControls'

const OFF = 'off'

/** Company edition only (the caller checks): the user turns on an irreversible deletion, so it asks first. */
export function SessionRetentionSettingsRow({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
}): React.JSX.Element {
  const confirm = useConfirmationDialog()
  const [error, setError] = useState(false)
  const current = normalizeSessionRetentionDays(settings.sessionRetentionDays)

  async function choose(value: string): Promise<void> {
    const days = value === OFF ? null : normalizeSessionRetentionDays(Number(value))
    setError(false)
    if (days !== null) {
      const accepted = await confirm({
        title: translate(
          'sessionHistory.settings.retentionConfirmTitle',
          'Delete chat copies older than {{days}} days?',
          { days }
        ),
        description: translate(
          'sessionHistory.settings.retentionConfirmBody',
          "After the next start of Madang, Madang's copies of chats idle for more than {{days}} days are deleted. This cannot be undone. Claude Code's own records are not deleted.",
          { days }
        ),
        confirmLabel: translate('sessionHistory.settings.retentionConfirmLabel', 'Turn on'),
        confirmVariant: 'destructive'
      })
      if (!accepted) {
        return
      }
    }
    try {
      await updateSettings({ sessionRetentionDays: days })
    } catch {
      setError(true)
    }
  }

  return (
    <SettingsRow
      className="border-t border-border"
      label={translate('sessionHistory.settings.retentionLabel', 'Delete old chat copies')}
      description={
        error
          ? translate('sessionHistory.settings.saveError', 'Could not save. Try again.')
          : translate(
              'sessionHistory.settings.retentionCopy',
              "Madang deletes its own copy of chats that were idle longer than this. Claude Code's own records are not deleted. This cannot be undone."
            )
      }
      control={
        <Select
          value={current === null ? OFF : String(current)}
          onValueChange={(v) => void choose(v)}
        >
          <SelectTrigger size="sm" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFF}>
              {translate('sessionHistory.settings.retentionOff', 'Off')}
            </SelectItem>
            {SESSION_RETENTION_DAY_OPTIONS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {translate('sessionHistory.settings.retentionDays', '{{days}} days', { days })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}
