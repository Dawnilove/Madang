// Export copies of relay-hosted SSH state without mutating source rows.
import {
  MADANGD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  type MadangdMigrationTerminalScrollbackSnapshot
} from '../../../shared/madangd-migration/madangd-migration-scrollback'
import type {
  MadangdMigrationCatalogPayload,
  MadangdMigrationDormantStatePayload,
  MadangdMigrationManifest,
  MadangdMigrationManifestSource
} from '../../../shared/madangd-migration/madangd-migration-manifest'
import { assertMadangdMigrationManifestDigest } from '../../madangd/madangd-migration-manifest-digest'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  collectMadangdMigrationUntransferredDependencyCensus,
  type MadangdMigrationSourceDependencyCensus
} from './madangd-source-dependency-census'
import { collectMadangdMigrationSourceDormantState } from './madangd-source-dormant-state'
import { readMadangdMigrationSourceScrollbackChunk } from './madangd-source-scrollback-state'
import {
  createMadangdMigrationDeltaView,
  type MadangdMigrationDeltaView
} from './madangd-source-delta-view'
import { syncMadangdMigrationScrollbackRetention } from './madangd-source-scrollback-retention'
import { createMadangdMigrationLeaveBehindView } from './madangd-source-leave-behind-view'
import {
  collectMadangdMigrationSourceDrafts,
  type MadangdMigrationSourceDrafts
} from './madangd-source-draft-rename'

type MadangdSourceExportRuntime = Pick<
  StoreRuntimeState,
  'state' | 'terminalScrollbackSnapshotStorage' | 'retainedScrollbackRefsByMigrationId'
>

const madangdSourceExportContext = Symbol('MadangdSourceExportPersistence')

export class MadangdSourceExportPersistence {
  readonly [madangdSourceExportContext]: MadangdSourceExportRuntime

  constructor(runtime: MadangdSourceExportRuntime) {
    this[madangdSourceExportContext] = runtime
  }

  collectMadangdMigrationSourceDormantState(
    source: MadangdMigrationManifestSource,
    catalog: MadangdMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ): MadangdMigrationDormantStatePayload {
    const runtime = this[madangdSourceExportContext]
    return collectMadangdMigrationSourceDormantState(
      runtime.state,
      source,
      catalog,
      runtime.terminalScrollbackSnapshotStorage,
      destinationEnvironmentId
    ).payload
  }

  collectMadangdMigrationSourceDrafts(manifest: MadangdMigrationManifest): MadangdMigrationSourceDrafts {
    return collectMadangdMigrationSourceDrafts(this[madangdSourceExportContext].state, manifest)
  }

  createMadangdMigrationDeltaView(moved: MadangdMigrationManifest): MadangdMigrationDeltaView {
    return createMadangdMigrationDeltaView(this[madangdSourceExportContext], moved)
  }

  /** Preview "Move anyway" without recording consent. */
  createMadangdMigrationLeaveBehindView(targetId: string): MadangdMigrationDeltaView {
    return createMadangdMigrationLeaveBehindView(this[madangdSourceExportContext], targetId)
  }

  inspectMadangdMigrationUntransferredDependencies(
    manifest: MadangdMigrationManifest
  ): MadangdMigrationSourceDependencyCensus {
    const runtime = this[madangdSourceExportContext]
    return collectMadangdMigrationUntransferredDependencyCensus(
      runtime.state,
      manifest,
      runtime.terminalScrollbackSnapshotStorage
    )
  }

  /** Retain unfinished migrations' snapshots even if their tabs close. */
  syncMadangdMigrationScrollbackRetention(pending: readonly MadangdMigrationManifest[]): void {
    syncMadangdMigrationScrollbackRetention(this[madangdSourceExportContext], pending)
  }

  /** Verify snapshot bytes against the signed manifest so changed buffers cannot be transferred. */
  readMadangdMigrationSourceSnapshotChunk(
    manifest: MadangdMigrationManifest,
    ref: string,
    offset: number
  ): { bytesBase64: string; totalBytes: number; eof: boolean } {
    assertMadangdMigrationManifestDigest(manifest)
    const descriptor: MadangdMigrationTerminalScrollbackSnapshot | undefined =
      manifest.payload.dormantState?.terminalScrollbackSnapshots?.find((entry) => entry.ref === ref)
    if (!descriptor) {
      throw new Error('madangd_migration_source_snapshot_unknown')
    }
    const runtime = this[madangdSourceExportContext]
    return readMadangdMigrationSourceScrollbackChunk({
      state: runtime.state,
      descriptor,
      retained: [...runtime.retainedScrollbackRefsByMigrationId.values()].some((refs) =>
        refs.has(ref)
      ),
      offset,
      length: MADANGD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
      storage: runtime.terminalScrollbackSnapshotStorage
    })
  }
}
