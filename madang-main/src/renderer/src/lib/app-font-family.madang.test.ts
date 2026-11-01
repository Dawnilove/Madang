import { describe, expect, it } from 'vitest'
import { buildAppFontFamily } from './app-font-family'

describe('buildAppFontFamily (Madang rounded UI font)', () => {
  it('maps the untouched Orca default to the bundled rounded font', () => {
    expect(buildAppFontFamily('Geist').split(', ')[0]).toBe('"NanumSquareRound"')
    expect(buildAppFontFamily(undefined).split(', ')[0]).toBe('"NanumSquareRound"')
    expect(buildAppFontFamily('  ').split(', ')[0]).toBe('"NanumSquareRound"')
  })

  it('keeps a font the user picked', () => {
    expect(buildAppFontFamily('Georgia').split(', ')[0]).toBe('"Georgia"')
  })

  it('keeps Geist as a fallback for missing glyphs', () => {
    expect(buildAppFontFamily('Geist')).toContain('"Geist"')
  })
})
