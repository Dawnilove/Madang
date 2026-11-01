import { resolveColorTheme, type ColorTheme } from '../../../shared/color-theme'
import { useAppStore } from '../store'

export function useColorTheme(): ColorTheme {
  return useAppStore((s) => resolveColorTheme(s.settings?.colorTheme))
}
