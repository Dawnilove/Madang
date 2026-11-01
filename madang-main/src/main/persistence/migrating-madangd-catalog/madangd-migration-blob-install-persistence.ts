import { MADANGD_MIGRATION_BLOB_KIND_CONTRACTS } from '../../../shared/madangd-migration/madangd-migration-blob-transfer'
import type { MadangdMigrationManifest } from '../../../shared/madangd-migration/madangd-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { getHistoryRoot } from '../../terminal-history-paths'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  findMadangdMigrationImportReceipt,
  isMadangdMigrationCommitDurable
} from './madangd-catalog-receipt-ledger'
import { installMadangdMigrationReceivedBlobs } from './madangd-migration-blob-installers'
import { listMadangdMigrationReceivedBlobNames } from './madangd-migration-blob-staging'
import type { MadangdMigrationRequestIdentity } from './madangd-migration-staged-file'

type MadangdMigrationBlobInstallRuntime = Pick<
  StoreRuntimeState,
  | 'state'
  | 'madangdMigrationBlobRoot'
  | 'madangdTerminalRestoreHints'
  | 'paneShellPath'
  | 'deferredShellHistoryWorktreeIds'
  | 'writeGeneration'
  | 'lastDurableWriteGeneration'
  | 'madangdMigrationCommitWriteGenerations'
>

type ClockOptions = { now?: () => Date }
type InstallOptions = ClockOptions & {
  /** Defer history installation while shells run in its worktree. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
}

const madangdMigrationBlobInstallContext = Symbol('MadangdMigrationBlobInstallPersistence')
type MadangdMigrationBlobInstallContext = {
  runtime: MadangdMigrationBlobInstallRuntime
}

export class MadangdMigrationBlobInstallPersistence {
  readonly [madangdMigrationBlobInstallContext]: MadangdMigrationBlobInstallContext

  constructor(runtime: MadangdMigrationBlobInstallRuntime) {
    this[madangdMigrationBlobInstallContext] = { runtime }
  }

  /** Wait for durable commit or a restart could lose both the catalog and its consumed blobs. */
  installMadangdMigrationReceivedBlobs(
    manifest: MadangdMigrationManifest,
    options: InstallOptions = {}
  ): void {
    const receipt = findMadangdMigrationImportReceipt(
      this[madangdMigrationBlobInstallContext].runtime.state,
      manifest
    )
    if (receipt?.manifestSha256 !== manifest.manifestSha256) {
      return
    }
    installCommitted(this[madangdMigrationBlobInstallContext].runtime, manifest, options)
  }

  /** Recover interrupted installs; disk-loaded receipts already prove durability. */
  installPendingMadangdMigrationReceivedBlobs(options: InstallOptions = {}): void {
    const { runtime } = this[madangdMigrationBlobInstallContext]
    for (const receipt of [
      ...(runtime.state.madangdMigrationImportReceipts ?? []),
      ...(runtime.state.madangdMigrationEvictedReceipts ?? [])
    ]) {
      try {
        installCommitted(runtime, receipt, options)
      } catch (error) {
        console.error(
          `[madangd-migration] installing received blobs for ${receipt.migrationId} failed:`,
          error
        )
      }
    }
  }

  /** Only the runtime installs pending shell history. */
  hasPendingMadangdMigrationShellHistory(): boolean {
    const { runtime } = this[madangdMigrationBlobInstallContext]
    return [
      ...(runtime.state.madangdMigrationImportReceipts ?? []),
      ...(runtime.state.madangdMigrationEvictedReceipts ?? [])
    ].some((receipt) =>
      listMadangdMigrationReceivedBlobNames(
        runtime.madangdMigrationBlobRoot,
        receipt,
        'shell-history'
      ).some((key) => MADANGD_MIGRATION_BLOB_KIND_CONTRACTS['shell-history'].key.test(key))
    )
  }

  installDeferredMadangdMigrationShellHistory(
    worktreeId: string,
    options: InstallOptions = {}
  ): void {
    const { runtime } = this[madangdMigrationBlobInstallContext]
    if (runtime.deferredShellHistoryWorktreeIds.has(worktreeId)) {
      this.installPendingMadangdMigrationReceivedBlobs(options)
    }
  }

  /** Read without consuming. */
  peekMadangdMigrationTerminalRestoreHint(
    paneKey: string,
    worktreeId: string,
    options: ClockOptions = {}
  ): string | null {
    return this[madangdMigrationBlobInstallContext].runtime.madangdTerminalRestoreHints.peek(
      paneKey,
      worktreeId,
      clock(options)
    )
  }

  /** Consume after spawn, even if it used a different cwd. */
  consumeMadangdMigrationTerminalRestoreHint(paneKey: string, options: ClockOptions = {}): void {
    this[madangdMigrationBlobInstallContext].runtime.madangdTerminalRestoreHints.consume(
      paneKey,
      clock(options)
    )
  }
}

function installCommitted(
  runtime: MadangdMigrationBlobInstallRuntime,
  migration: MadangdMigrationRequestIdentity,
  options: InstallOptions
): void {
  if (!isMadangdMigrationCommitDurable(runtime, migration)) {
    return
  }
  installMadangdMigrationReceivedBlobs({
    migration,
    root: runtime.madangdMigrationBlobRoot,
    terminalRestoreHints: runtime.madangdTerminalRestoreHints,
    shellHistoryRoot: getHistoryRoot(),
    paneShellPath: () => runtime.paneShellPath(runtime.state.settings?.terminalDefaultShell),
    worktreeHasLiveShells: options.worktreeHasLiveShells,
    deferredShellHistoryWorktreeIds: runtime.deferredShellHistoryWorktreeIds,
    paneWorktreeId: (paneKey) => findPaneWorktreeId(runtime.state, paneKey),
    now: clock(options)
  })
}

function clock(options: ClockOptions): number {
  return (options.now ?? (() => new Date()))().getTime()
}

function findPaneWorktreeId(state: PersistedState, paneKey: string): string | null {
  const tabId = parsePaneKey(paneKey)?.tabId
  if (!tabId) {
    return null
  }
  const sessions = [state.workspaceSession, ...Object.values(state.workspaceSessionsByHostId ?? {})]
  for (const session of sessions) {
    for (const [worktreeId, tabs] of Object.entries(session?.tabsByWorktree ?? {})) {
      if (tabs.some((tab) => tab.id === tabId)) {
        return worktreeId
      }
    }
  }
  return null
}
