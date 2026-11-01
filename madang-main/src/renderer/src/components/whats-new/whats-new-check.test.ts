import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkWhatsNew } from './whats-new-check'

const notes = { title: 'Madang 1.1.0', body: '- 새 기능', url: 'https://github.com/x/y/releases/1' }
const updater = { getVersion: vi.fn(), getReleaseNotes: vi.fn() }

beforeEach(() => {
  updater.getVersion.mockReset()
  updater.getReleaseNotes.mockReset()
  vi.stubGlobal('window', { api: { updater } })
})
afterEach(() => vi.unstubAllGlobals())

describe('checkWhatsNew', () => {
  it('first install: records the version and shows nothing', async () => {
    updater.getVersion.mockResolvedValue('1.1.0')
    const record = vi.fn()

    await expect(checkWhatsNew(undefined, record)).resolves.toBeNull()
    expect(record).toHaveBeenCalledWith('1.1.0')
    expect(updater.getReleaseNotes).not.toHaveBeenCalled()
  })

  it('same version: does nothing', async () => {
    updater.getVersion.mockResolvedValue('1.1.0')
    const record = vi.fn()

    await expect(checkWhatsNew('1.1.0', record)).resolves.toBeNull()
    expect(record).not.toHaveBeenCalled()
    expect(updater.getReleaseNotes).not.toHaveBeenCalled()
  })

  it('different version: returns the notes without recording yet', async () => {
    updater.getVersion.mockResolvedValue('1.1.0')
    updater.getReleaseNotes.mockResolvedValue(notes)
    const record = vi.fn()

    await expect(checkWhatsNew('1.0.0', record)).resolves.toEqual({ version: '1.1.0', notes })
    expect(record).not.toHaveBeenCalled()
  })

  it('offline or error: shows nothing and records nothing', async () => {
    updater.getVersion.mockResolvedValue('1.1.0')
    const record = vi.fn()

    updater.getReleaseNotes.mockResolvedValue(null)
    await expect(checkWhatsNew('1.0.0', record)).resolves.toBeNull()
    updater.getReleaseNotes.mockRejectedValue(new Error('ipc failed'))
    await expect(checkWhatsNew('1.0.0', record)).resolves.toBeNull()
    expect(record).not.toHaveBeenCalled()
  })
})
