import { DEFAULT_APP_FONT_FAMILY } from '../../../shared/constants'
import { MADANG_UI_FONT_FAMILY } from '../../../shared/madang-features'
import { madangUx } from './madang-ux'

const APP_FONT_FALLBACKS = [
  DEFAULT_APP_FONT_FAMILY,
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'sans-serif'
] as const

const CSS_FONT_KEYWORDS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'blinkmacsystemfont'
])

function quoteFontFamily(fontFamily: string): string {
  if (fontFamily.startsWith('-') || CSS_FONT_KEYWORDS.has(fontFamily.toLowerCase())) {
    return fontFamily
  }
  return JSON.stringify(fontFamily)
}

/** Madang: the untouched Orca default (Geist) means "no choice made", so it maps to Madang's font. */
function resolveAppFontFamily(fontFamily: string | null | undefined): string {
  const trimmed = fontFamily?.trim() || DEFAULT_APP_FONT_FAMILY
  // Why: existing profiles store 'Geist' explicitly, so changing only the default would miss them.
  if (madangUx.roundedUiFont && trimmed === DEFAULT_APP_FONT_FAMILY) {
    return MADANG_UI_FONT_FAMILY
  }
  return trimmed
}

export function buildAppFontFamily(fontFamily: string | null | undefined): string {
  const trimmed = resolveAppFontFamily(fontFamily)
  const lowerTrimmed = trimmed.toLowerCase()
  const parts = [
    trimmed,
    ...APP_FONT_FALLBACKS.filter((fallback) => fallback.toLowerCase() !== lowerTrimmed)
  ]
  return parts.map(quoteFontFamily).join(', ')
}
