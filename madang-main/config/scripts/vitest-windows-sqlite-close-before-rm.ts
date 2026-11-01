import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { resolve, sep } from 'node:path'

// Why: Windows cannot delete an open SQLite file, so tests that rm a temp dir with a live DB fail with EBUSY/EPERM.
type OpenDatabase = { path: string; db: { isOpen: boolean; close(): void } }
type DatabaseSyncClass = new (path: unknown, options?: unknown) => OpenDatabase['db']

const opened = new Set<OpenDatabase>()

function closeUnder(target: unknown): void {
  if (typeof target !== 'string') {
    return
  }
  const root = resolve(target)
  for (const entry of opened) {
    if (entry.path === root || entry.path.startsWith(root + sep)) {
      opened.delete(entry)
      if (entry.db.isOpen) {
        entry.db.close()
      }
    }
  }
}

function trackDatabases(): void {
  const sqlite = process.getBuiltinModule?.('node:sqlite') as
    | { DatabaseSync: DatabaseSyncClass }
    | undefined
  if (!sqlite) {
    return
  }
  const Base = sqlite.DatabaseSync
  sqlite.DatabaseSync = class extends Base {
    constructor(path: unknown, options?: unknown) {
      super(path, options)
      if (typeof path === 'string' && path !== ':memory:') {
        opened.add({ path: resolve(path), db: this })
      }
    }
  }
}

function closeBeforeRemove(api: typeof fs | typeof fs.promises, name: 'rm' | 'rmSync'): void {
  const original: unknown = Reflect.get(api, name)
  if (typeof original !== 'function') {
    return
  }
  Reflect.set(api, name, function (this: unknown, target: unknown, ...rest: unknown[]) {
    closeUnder(target)
    return Reflect.apply(original, this, [target, ...rest])
  })
}

if (process.platform === 'win32' && !process.versions.bun) {
  trackDatabases()
  closeBeforeRemove(fs, 'rmSync')
  closeBeforeRemove(fs, 'rm')
  closeBeforeRemove(fs.promises, 'rm')
  syncBuiltinESMExports()
}
