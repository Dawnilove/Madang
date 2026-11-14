import { translate } from '@/i18n/i18n'
import { isCompanyEdition } from '../../../../shared/madang-edition'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'

type Key = 'accountAutoSwitch' | 'accountAutoSwitchUseResetCredit'

/** One switch of the auto-switch feature. Hidden in the company edition, which never reads usage. */
export function AccountAutoSwitchSetting({
  settingKey,
  settings,
  updateSettings
}: {
  settingKey: Key
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (isCompanyEdition()) {
    return null
  }
  const isMain = settingKey === 'accountAutoSwitch'
  const label = isMain
    ? translate('accounts.autoSwitch.label', 'Switch accounts automatically near the limit')
    : translate('accounts.autoSwitch.resetCreditLabel', 'Use a reset credit when no account has room')
  const description = isMain
    ? translate(
        'accounts.autoSwitch.description',
        'When the active Claude or Codex account reaches 90% of its 5-hour or weekly limit, Madang switches to the least-used account below 85%. Needs usage display turned on. Works while the Madang window is in use.'
      )
    : translate(
        'accounts.autoSwitch.resetCreditDescription',
        'Codex only. Needs automatic switching turned on. Spends one of your rate-limit reset credits without asking.'
      )
  // Why: the credit switch does nothing alone, so it follows the main switch.
  const disabled = !isMain && settings.accountAutoSwitch !== true
  return (
    <SearchableSetting
      title={label}
      description={description}
      keywords={['account', 'switch', 'auto', 'usage', 'rate limit', 'reset credit']}
      className="flex items-center justify-between gap-4 py-2"
    >
      <div className="space-y-0.5">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={label}
        disabled={disabled}
        checked={settings[settingKey] === true}
        onCheckedChange={(checked) => updateSettings({ [settingKey]: checked })}
      />
    </SearchableSetting>
  )
}
