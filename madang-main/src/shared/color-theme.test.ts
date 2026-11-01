import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_COLOR_THEME, resolveColorTheme } from './color-theme'
import { getDefaultSettings } from './constants'
import { TERMINAL_THEME_CATALOG } from './terminal-themes'

describe('color theme', () => {
  it('starts on the Madang palette and keeps lime-dark selectable', () => {
    expect(DEFAULT_COLOR_THEME).toBe('madang')
    expect(resolveColorTheme('lime-dark')).toBe('lime-dark')
    expect(resolveColorTheme(undefined)).toBe('madang')
    expect(resolveColorTheme('not-a-theme')).toBe('madang')
  })

  it('gives new profiles light mode with the Madang terminal themes', () => {
    const settings = getDefaultSettings('/home/test')
    expect(settings.theme).toBe('light')
    expect(settings.colorTheme).toBe('madang')
    expect(settings.terminalThemeLight).toBe('Madang')
    expect(settings.terminalThemeDark).toBe('Madang Dark')
    expect(TERMINAL_THEME_CATALOG['Madang']).toBeDefined()
    expect(TERMINAL_THEME_CATALOG['Madang Dark']).toBeDefined()
    expect(TERMINAL_THEME_CATALOG['JetDeck Lime Dark']).toBeDefined()
  })

  it('keeps the roof-colored primary button readable in both Madang palettes', () => {
    const css = readFileSync(
      new URL('../renderer/src/assets/adak-theme.css', import.meta.url),
      'utf8'
    )
    const channel = (value: number): number =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((start) =>
        channel(Number.parseInt(hex.slice(start, start + 2), 16) / 255)
      )
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (a: string, b: string): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    const markers = [
      ":root:not([data-madang-theme='lime-dark']):not(.dark) {",
      ":root:not([data-madang-theme='lime-dark']).dark {"
    ]
    for (const marker of markers) {
      const start = css.indexOf(marker)
      const block = css.slice(start, css.indexOf('\n}', start))
      const token = (name: string): string =>
        new RegExp(`${name}: (#[0-9a-f]{6});`).exec(block)?.[1] ?? ''
      expect(
        contrast(token('--primary'), token('--primary-foreground')),
        marker
      ).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token('--primary'), token('--background')), marker).toBeGreaterThanOrEqual(3)
    }
  })

  it('defines the three palettes in the theme stylesheet', () => {
    const css = readFileSync(
      new URL('../renderer/src/assets/adak-theme.css', import.meta.url),
      'utf8'
    )
    expect(css).toContain(":root:not([data-madang-theme='lime-dark']):not(.dark)")
    expect(css).toContain(":root:not([data-madang-theme='lime-dark']).dark")
    expect(css).toContain(":root[data-madang-theme='lime-dark'].dark")
  })
})
