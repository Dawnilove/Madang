import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeWindow = {
  isDestroyed: () => boolean
  setOverlayIcon: ReturnType<typeof vi.fn>
}

const windows = vi.hoisted(() => [] as FakeWindow[])

vi.mock('electron', () => ({
  app: { dock: undefined },
  BrowserWindow: { getAllWindows: () => windows },
  nativeImage: { createFromBitmap: (buffer: Buffer) => ({ buffer }) }
}))

import { buildOverlayDotBitmap, setUnreadDockBadgeCount } from './unread-badge'

function fakeWindow(): FakeWindow {
  return { isDestroyed: () => false, setOverlayIcon: vi.fn() }
}

describe('buildOverlayDotBitmap', () => {
  it('fills the centre with opaque amber and leaves the corners transparent', () => {
    const bitmap = buildOverlayDotBitmap(16)
    expect(bitmap.length).toBe(16 * 16 * 4)
    const centre = (8 * 16 + 8) * 4
    expect([...bitmap.subarray(centre, centre + 4)]).toEqual([0x0b, 0x9e, 0xf5, 0xff])
    expect([...bitmap.subarray(0, 4)]).toEqual([0, 0, 0, 0])
  })
})

describe.runIf(process.platform === 'win32')('setUnreadDockBadgeCount on Windows', () => {
  beforeEach(() => {
    windows.length = 0
    setUnreadDockBadgeCount(0)
  })

  it('shows the dot with the count, updates it, and clears it at zero', () => {
    const win = fakeWindow()
    windows.push(win)

    setUnreadDockBadgeCount(2)
    expect(win.setOverlayIcon).toHaveBeenLastCalledWith(expect.anything(), '2')

    setUnreadDockBadgeCount(1)
    expect(win.setOverlayIcon).toHaveBeenLastCalledWith(expect.anything(), '1')

    setUnreadDockBadgeCount(0)
    expect(win.setOverlayIcon).toHaveBeenLastCalledWith(null, '')
  })

  it('skips repeated counts and never flashes the taskbar button', () => {
    const win = { ...fakeWindow(), flashFrame: vi.fn() }
    windows.push(win)

    setUnreadDockBadgeCount(1)
    setUnreadDockBadgeCount(1)
    expect(win.setOverlayIcon).toHaveBeenCalledTimes(1)
    expect(win.flashFrame).not.toHaveBeenCalled()
  })
})
