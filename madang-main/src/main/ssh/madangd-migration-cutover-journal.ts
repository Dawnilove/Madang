/** Persist journals in owner-only profile sidecars: older profile schemas drop unknown fields but retain fences, so an in-profile journal could vanish on downgrade. Unreadable journals fail closed. */
import {
  MAX_MADANGD_MIGRATION_SOURCE_CUTOVERS,
  isRetainedMadangdMigrationSourceCutover,
  parseMadangdMigrationSourceCutover,
  type MadangdMigrationSourceCutover
} from '../../shared/madangd-migration/madangd-migration-source-cutover'
import {
  createMigrationJournalDirectory,
  orderMigrationJournalChain
} from '../persistence/migrating-madangd-catalog/migration-journal-directory'

class MadangdMigrationCutoverJournalUnreadableError extends Error {
  constructor(detail: string) {
    super(`The migration journal cannot be read, so the SSH host stays fenced: ${detail}`)
    this.name = 'MadangdMigrationCutoverJournalUnreadableError'
  }
}

type JournalChangeListener = (userDataPath: string) => void
let journalChangeListener: JournalChangeListener | null = null

export function setMadangdMigrationJournalChangeListener(
  listener: JournalChangeListener | null
): void {
  journalChangeListener = listener
}

const journals = createMigrationJournalDirectory({
  directoryName: 'madangd-migration-cutovers',
  // A manifest carries catalog rows and dormant session state, never scrollback bytes.
  maxFileBytes: 16 * 1024 * 1024,
  parse: parseMadangdMigrationSourceCutover,
  unreadable: (detail) => new MadangdMigrationCutoverJournalUnreadableError(detail),
  onChange: (userDataPath) => journalChangeListener?.(userDataPath)
})

export function madangdMigrationCutoverJournalDirectory(userDataPath: string): string {
  return journals.directory(userDataPath)
}

/** Never skip an unreadable or untrusted journal. */
export function listMadangdMigrationSourceCutovers(
  userDataPath: string
): MadangdMigrationSourceCutover[] {
  return journals.list(userDataPath)
}

export function findMadangdMigrationSourceCutoverForTarget(
  userDataPath: string,
  sshTargetId: string
): MadangdMigrationSourceCutover | null {
  const chain = listMadangdMigrationCutoverChainForTarget(userDataPath, sshTargetId)
  return chain.at(-1) ?? null
}

/** Oldest first; throws unless the target's journals form one chain of delta moves. */
export function listMadangdMigrationCutoverChainForTarget(
  userDataPath: string,
  sshTargetId: string
): MadangdMigrationSourceCutover[] {
  const matches = listMadangdMigrationSourceCutovers(userDataPath).filter(
    (cutover) => cutover.sshTargetId === sshTargetId
  )
  return orderMigrationJournalChain(
    matches,
    (detail) => new MadangdMigrationCutoverJournalUnreadableError(detail),
    `SSH target ${sshTargetId}`
  )
}

/** Flush before returning so later fence writes always have a durable journal. */
export function writeMadangdMigrationSourceCutover(
  userDataPath: string,
  cutover: MadangdMigrationSourceCutover
): void {
  const parsed = parseMadangdMigrationSourceCutover(cutover)
  const existing = listMadangdMigrationSourceCutovers(userDataPath)
  // Finished retained cutovers can wait two releases; only in-flight journals count toward the bound.
  const inFlight = existing.filter(
    (entry) => entry.phase !== 'source-retired' && !isRetainedMadangdMigrationSourceCutover(entry)
  )
  if (
    !existing.some((entry) => entry.migrationId === parsed.migrationId) &&
    inFlight.length >= MAX_MADANGD_MIGRATION_SOURCE_CUTOVERS
  ) {
    throw new Error('madangd_migration_cutover_capacity_exceeded')
  }
  journals.write(userDataPath, parsed)
}

export function removeMadangdMigrationSourceCutover(userDataPath: string, migrationId: string): void {
  journals.remove(userDataPath, migrationId)
}

export function removeMadangdMigrationJournalsForDestination(
  userDataPath: string,
  sshTargetId: string,
  environmentId: string
): void {
  for (const cutover of listMadangdMigrationSourceCutovers(userDataPath)) {
    if (cutover.sshTargetId === sshTargetId && cutover.destinationEnvironmentId === environmentId) {
      removeMadangdMigrationSourceCutover(userDataPath, cutover.migrationId)
    }
  }
}
