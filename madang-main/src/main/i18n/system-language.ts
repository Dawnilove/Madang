import { app } from 'electron'
import { isOrcaDefaultsRequested } from '../../shared/madang-features'
import { detectUiLanguage, type UiLanguageDetection } from '../../shared/ui-locale'

let snapshot: UiLanguageDetection | null | undefined

export function getSystemLanguageDetection(
  browserPreferences?: readonly string[]
): UiLanguageDetection | null {
  if (snapshot === undefined) {
    try {
      if (!app.isReady()) {
        return null
      }
      // Upstream e2e specs match English names; an e2e launch asking for Orca's defaults also gets Orca's English.
      const preferences = isOrcaDefaultsRequested() ? ['en-US'] : app.getPreferredSystemLanguages()
      snapshot = preferences.length ? detectUiLanguage(preferences, 'native') : null
    } catch {
      snapshot = null
    }
  }
  if (snapshot === null && browserPreferences) {
    snapshot = detectUiLanguage(browserPreferences, 'browser-fallback')
  }
  return snapshot
}
