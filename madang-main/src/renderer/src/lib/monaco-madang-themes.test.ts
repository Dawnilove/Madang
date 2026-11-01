import { describe, expect, it, vi } from 'vitest'
import {
  MADANG_DARK_MONACO_THEME,
  MADANG_LIGHT_MONACO_THEME,
  MADANG_MONACO_THEMES,
  monacoThemeName,
  registerMadangMonacoThemes
} from './monaco-madang-themes'

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('Madang Monaco themes', () => {
  it('picks the Madang theme by mode and keeps the built-in ones for lime-dark', () => {
    expect(monacoThemeName(false, 'madang')).toBe(MADANG_LIGHT_MONACO_THEME)
    expect(monacoThemeName(true, 'madang')).toBe(MADANG_DARK_MONACO_THEME)
    expect(monacoThemeName(true, 'lime-dark')).toBe('vs-dark')
    expect(monacoThemeName(false, 'lime-dark')).toBe('vs')
  })

  it('registers both themes under their names', () => {
    const defineTheme = vi.fn()
    registerMadangMonacoThemes({ editor: { defineTheme } })
    expect(defineTheme.mock.calls.map(([name]) => name).sort()).toEqual([
      MADANG_DARK_MONACO_THEME,
      MADANG_LIGHT_MONACO_THEME
    ])
    expect(MADANG_MONACO_THEMES[MADANG_LIGHT_MONACO_THEME].base).toBe('vs')
    expect(MADANG_MONACO_THEMES[MADANG_DARK_MONACO_THEME].base).toBe('vs-dark')
  })

  it.each(Object.entries(MADANG_MONACO_THEMES))(
    '%s keeps text readable on its background (4.5:1)',
    (_name, theme) => {
      const background = theme.colors['editor.background']
      expect(contrast(theme.colors['editor.foreground'], background)).toBeGreaterThanOrEqual(4.5)
      for (const rule of theme.rules) {
        expect(contrast(`#${rule.foreground}`, background)).toBeGreaterThanOrEqual(4.5)
      }
      expect(
        contrast(theme.colors['editorLineNumber.foreground'], background)
      ).toBeGreaterThanOrEqual(3)
    }
  )
})
