import { describe, expect, it, vi } from 'vitest'
import {
  emitMadangdProfileStateAuthoritySelected,
  formatMadangdProfileStateAuthoritySelected,
  type MadangdProfileStateAuthoritySelection
} from './madangd-profile-state-telemetry'

const selection: MadangdProfileStateAuthoritySelection = {
  backend: 'sqlite',
  classification: 'json-only',
  authority_mode: 'sqlite-established',
  runtime: 'madangd',
  migrated: true
}

describe('madangd profile-state telemetry', () => {
  it('formats a bounded machine-readable authority selection event', () => {
    const prefix = '[madangd-telemetry] '
    expect(
      JSON.parse(formatMadangdProfileStateAuthoritySelected(selection).slice(prefix.length))
    ).toEqual({
      event: 'profile_state_authority_selected',
      ...selection
    })
  })

  it('strips unexpected runtime fields before writing the record', () => {
    const selectionWithRuntimeFields = Object.assign({}, selection, {
      database_path: '/private/profile-state.db'
    })
    const line = formatMadangdProfileStateAuthoritySelected(selectionWithRuntimeFields)
    expect(line).not.toContain('database_path')
  })

  it('sends the event to the supplied sink', () => {
    const sink = vi.fn()
    emitMadangdProfileStateAuthoritySelected(selection, sink)
    expect(sink).toHaveBeenCalledOnce()
    expect(sink).toHaveBeenCalledWith(formatMadangdProfileStateAuthoritySelected(selection))
  })

  it('never lets a failing sink block startup', () => {
    expect(() =>
      emitMadangdProfileStateAuthoritySelected(selection, () => {
        throw new Error('closed stderr')
      })
    ).not.toThrow()
  })
})
