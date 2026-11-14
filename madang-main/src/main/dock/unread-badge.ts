import { app, BrowserWindow, nativeImage, type NativeImage } from 'electron'

let unreadCount = 0

function applyDockBadge(): void {
  const label = unreadCount === 0 ? '' : unreadCount > 99 ? '99+' : String(unreadCount)
  app.dock?.setBadge(label)
}

const OVERLAY_SIZE = 16
let overlayDot: NativeImage | undefined

/** A filled amber circle (the renderer's attention color) as BGRA pixels; no image asset needed. */
export function buildOverlayDotBitmap(size: number): Buffer {
  const bitmap = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  const radiusSq = (size / 2) ** 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - center) ** 2 + (y - center) ** 2 <= radiusSq) {
        bitmap.set([0x0b, 0x9e, 0xf5, 0xff], (y * size + x) * 4)
      }
    }
  }
  return bitmap
}

// Why: Windows has no numeric taskbar badge, so a dot on the taskbar button stands in for the Dock count.
// shortcut: a window opened while the count stays the same gets its dot on the next count change.
function applyWindowsTaskbar(): void {
  overlayDot ??= nativeImage.createFromBitmap(buildOverlayDotBitmap(OVERLAY_SIZE), {
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE
  })
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) {
      continue
    }
    win.setOverlayIcon(unreadCount > 0 ? overlayDot : null, unreadCount > 0 ? `${unreadCount}` : '')
  }
}

export function setUnreadDockBadgeCount(count: number): void {
  const previousCount = unreadCount
  unreadCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0

  if (process.platform === 'darwin') {
    applyDockBadge()
  } else if (process.platform === 'win32' && unreadCount !== previousCount) {
    applyWindowsTaskbar()
  }
}
