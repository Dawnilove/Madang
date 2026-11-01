import { describe, expect, it } from 'vitest'
import { decideWhatsNew } from './whats-new'

describe('decideWhatsNew', () => {
  it('records only on a first install (no saved version)', () => {
    expect(decideWhatsNew(undefined, '1.0.0')).toBe('record')
    expect(decideWhatsNew('', '1.0.0')).toBe('record')
  })

  it('does nothing for the same version', () => {
    expect(decideWhatsNew('1.0.0', '1.0.0')).toBe('none')
  })

  it('fetches the notes when the version changed', () => {
    expect(decideWhatsNew('1.0.0-beta.1', '1.0.0')).toBe('fetch')
  })

  it('does nothing when the current version is not a real version (web client)', () => {
    expect(decideWhatsNew(undefined, 'web')).toBe('none')
    expect(decideWhatsNew('1.0.0', 'web')).toBe('none')
  })
})
