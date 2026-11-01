/** Expose fenced-source checks/release through the cutover port; conversion owns terminal assessment, export and fence acquisition. */
import type { MadangdMigrationSourceKind } from '../../shared/madangd-migration/madangd-migration-source-kind'
import type {
  MadangdMigrationCatalogPayload,
  MadangdMigrationManifest
} from '../../shared/madangd-migration/madangd-migration-manifest'
import type { MadangdMigrationSourceCutover } from '../../shared/madangd-migration/madangd-migration-source-cutover'
import type { MadangdMigrationManifestExportOptions } from './madangd-migration-manifest-export'
import type {
  MadangdMigrationFenceResult,
  MadangdMigrationFenceState
} from './madangd-migration-source-fence'
import type { MadangdMigrationTerminalVerdict } from './madangd-migration-terminal-gate'

export type MadangdMigrationSourceCutoverPort = {
  /** Before every stage and commit; throws unless the fenced source still matches the journal. */
  verifyFence: (cutover: MadangdMigrationSourceCutover) => void
  /** Drops the fence, then the journal; only on proof the destination holds nothing. */
  releaseFence: (cutover: MadangdMigrationSourceCutover) => Promise<void>
}

type MadangdMigrationFenceAcquireArgs = {
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: MadangdMigrationTerminalVerdict
  now?: () => Date
  signal?: AbortSignal
}

export type MadangdMigrationSource = MadangdMigrationSourceCutoverPort & {
  readonly kind: MadangdMigrationSourceKind
  readonly journalKey: string
  collectCatalog: () => MadangdMigrationCatalogPayload
  /** Rewrite paths before signing; export must not mutate source. */
  exportManifest: (options?: MadangdMigrationManifestExportOptions) => MadangdMigrationManifest
  /** Before the fence. Loss of contact is `unverifiable`, never `exited`. */
  assessTerminals: () => Promise<MadangdMigrationTerminalVerdict>
  retireProvenExitedTerminals: (proof: MadangdMigrationTerminalVerdict) => void
  /** Throws when the journal cannot be read: an unreadable record keeps the source fenced. */
  resolveFence: () => MadangdMigrationFenceState
  /** Journal, then fence, then flush, then the terminal re-check under the fence. */
  acquireFence: (args: MadangdMigrationFenceAcquireArgs) => Promise<MadangdMigrationFenceResult>
}
