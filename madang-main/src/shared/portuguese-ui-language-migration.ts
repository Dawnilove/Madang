import type { GlobalSettings } from './global-settings-types'
import { normalizeUiLanguage } from './ui-language'

type PortugueseUiLanguageSettings = Pick<
  GlobalSettings,
  'uiLanguage' | 'uiLanguagePortugueseMigrationApplied'
>

export function migratePortugueseUiLanguageOnLoad(
  settings: Partial<PortugueseUiLanguageSettings> | undefined
): PortugueseUiLanguageSettings {
  return {
    // Madang ships no Portuguese language plugin: the stamp stays so older stores keep loading.
    uiLanguage: normalizeUiLanguage(settings?.uiLanguage),
    uiLanguagePortugueseMigrationApplied: true
  }
}
