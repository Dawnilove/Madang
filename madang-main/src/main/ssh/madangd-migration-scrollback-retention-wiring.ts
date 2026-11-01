import type { Store } from '../persistence'
import {
  listMadangdMigrationSourceCutovers,
  setMadangdMigrationJournalChangeListener
} from './madangd-migration-cutover-journal'

export function installMadangdMigrationScrollbackRetention(
  userDataPath: string,
  store: Pick<Store, 'syncMadangdMigrationScrollbackRetention'>
): void {
  const sync = (path: string): void => {
    try {
      // Retain bytes until durable commit/abort; closed tabs must still upload on retry.
      const pending = listMadangdMigrationSourceCutovers(path).filter(
        (cutover) => cutover.phase === 'source-fenced' || cutover.phase === 'destination-staged'
      )
      store.syncMadangdMigrationScrollbackRetention(pending.map((cutover) => cutover.manifest))
    } catch (error) {
      // An unreadable journal keeps whatever is held; releasing on a guess could lose bytes.
      console.warn('[madangd-migration] Could not sync scrollback retention:', error)
    }
  }
  setMadangdMigrationJournalChangeListener(sync)
  sync(userDataPath)
}
