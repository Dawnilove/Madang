import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: Windows allows symlinks only with Developer Mode or elevation, so symlink tests skip there instead of failing.
function probeSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'symlink-probe-'))
  try {
    symlinkSync(dir, join(dir, 'link'), 'dir')
    return true
  } catch {
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const canSymlink = probeSymlinks()
