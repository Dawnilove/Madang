import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveWatcherProcessEntryPath,
  resolveWatcherProcessEntryPathWithoutApp
} from './parcel-watcher-entry-path'

describe('resolveWatcherProcessEntryPath', () => {
  it('uses an adjacent entry when electron-vite appPath is already out/main', () => {
    const builtMainPath = path.join(process.cwd(), 'out', 'main')
    const adjacentEntry = path.join(builtMainPath, 'parcel-watcher-process-entry.js')

    expect(
      resolveWatcherProcessEntryPath(
        builtMainPath,
        false,
        (candidate) => candidate === adjacentEntry
      )
    ).toBe(adjacentEntry)
  })

  it('uses the nested build entry when appPath is the project root', () => {
    expect(resolveWatcherProcessEntryPath(process.cwd(), false, () => false)).toBe(
      path.join(process.cwd(), 'out', 'main', 'parcel-watcher-process-entry.js')
    )
  })

  it('uses the unpacked nested entry for packaged apps', () => {
    const appPath = path.join('C:', 'Madang', 'resources', 'app.asar')

    expect(resolveWatcherProcessEntryPath(appPath, true, () => true)).toBe(
      path.join(
        'C:',
        'Madang',
        'resources',
        'app.asar.unpacked',
        'out',
        'main',
        'parcel-watcher-process-entry.js'
      )
    )
  })

  it('uses the adjacent entry for a packaged host whose app root is not an asar', () => {
    // madangd ships this child beside madangd.js without Electron isPackaged or an out/main directory.
    const madangdRoot = path.join(path.sep, 'opt', 'orca')
    const adjacentEntry = path.join(madangdRoot, 'parcel-watcher-process-entry.js')

    expect(
      resolveWatcherProcessEntryPath(madangdRoot, true, (candidate) => candidate === adjacentEntry)
    ).toBe(adjacentEntry)
  })

  it('falls back to the nested entry when a non-asar packaged host ships no adjacent child', () => {
    const madangdRoot = path.join(path.sep, 'opt', 'orca')

    expect(resolveWatcherProcessEntryPath(madangdRoot, true, () => false)).toBe(
      path.join(madangdRoot, 'out', 'main', 'parcel-watcher-process-entry.js')
    )
  })

  it('uses resourcesPath for packaged Electron-as-Node serve processes', () => {
    const resourcesPath = path.join('Applications', 'Madang.app', 'Contents', 'Resources')
    const packagedEntry = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'out',
      'main',
      'parcel-watcher-process-entry.js'
    )

    expect(
      resolveWatcherProcessEntryPathWithoutApp(
        path.join(resourcesPath, 'unrelated-cwd'),
        resourcesPath,
        (candidate) => candidate === packagedEntry
      )
    ).toBe(packagedEntry)
  })

  it('keeps the cwd build fallback when resourcesPath has no packaged entry', () => {
    const appRoot = path.join('workspace', 'orca')

    expect(
      resolveWatcherProcessEntryPathWithoutApp(
        appRoot,
        path.join('node_modules', 'electron', 'Resources'),
        () => false
      )
    ).toBe(path.join(appRoot, 'out', 'main', 'parcel-watcher-process-entry.js'))
  })
})
