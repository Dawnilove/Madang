/** Palette family, chosen apart from light/dark mode (`GlobalSettings.theme`). */
export const COLOR_THEMES = ['madang', 'madang-neutral', 'lime-dark'] as const

export type ColorTheme = (typeof COLOR_THEMES)[number]

/**
 * Madang's logo palette (cream, green, terracotta); it has a light and a dark variant.
 * madang-neutral is the same palette with a greyer light mode (its dark mode is Madang's).
 */
export const DEFAULT_COLOR_THEME: ColorTheme = 'madang'

export function resolveColorTheme(value: unknown): ColorTheme {
  return COLOR_THEMES.find((theme) => theme === value) ?? DEFAULT_COLOR_THEME
}
