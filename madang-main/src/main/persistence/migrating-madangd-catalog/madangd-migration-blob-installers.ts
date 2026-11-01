// Validate blob contents before commit; install only advertised kinds after durable commit.
import { readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MadangdMigrationBlobKind } from '../../../shared/madangd-migration/madangd-migration-blob-transfer'
import type { MadangdMigrationManifest } from '../../../shared/madangd-migration/madangd-migration-manifest'
import {
  MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  parseMadangdMigrationTerminalRestoreHintsText,
  type MadangdMigrationTerminalRestoreHint
} from '../../../shared/madangd-migration/madangd-migration-terminal-restore-hints'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  getMadangdMigrationReceivedBlobPath,
  stagedMadangdMigrationBlobFiles
} from './madangd-migration-blob-staging'
import {
  madangdMigrationStagingKey,
  type MadangdMigrationRequestIdentity
} from './madangd-migration-staged-file'
import {
  assertMadangdMigrationShellHistoryValid,
  installMadangdMigrationShellHistory
} from './madangd-shell-history-installer'
import type {
  MadangdTerminalRestoreHintPlacement,
  MadangdTerminalRestoreHintStore
} from './madangd-terminal-restore-hint-store'

type MadangdMigrationStagedBlobFile = {
  key: string
  path: string
  manifest: MadangdMigrationManifest
}

type MadangdMigrationBlobContentCheck = (file: MadangdMigrationStagedBlobFile) => void

const UTF8 = new TextDecoder('utf-8', { fatal: true })

const BLOB_CONTENT_CHECKS: Partial<Record<MadangdMigrationBlobKind, MadangdMigrationBlobContentCheck>> =
  {
    'terminal-restore-hints': ({ path }) => {
      parseMadangdMigrationTerminalRestoreHintsText(decodeUtf8(readFileSync(path)))
    },
    'shell-history': ({ key, path, manifest }) => {
      assertMadangdMigrationShellHistoryValid(key, path, manifest.payload)
    }
  }

/** Reject malformed content before commit while the source still owns everything. */
export function assertMadangdMigrationBlobContentsValid(
  manifest: MadangdMigrationManifest,
  root: string
): void {
  for (const { descriptor, path } of stagedMadangdMigrationBlobFiles(manifest, root)) {
    const check = BLOB_CONTENT_CHECKS[descriptor.blobKind]
    if (!check) {
      continue
    }
    try {
      check({ key: descriptor.key, path, manifest })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`madangd_migration_blob_content_invalid:${descriptor.blobKind}:${reason}`)
    }
  }
}

export type MadangdMigrationBlobInstall = {
  migration: MadangdMigrationRequestIdentity
  root: string
  terminalRestoreHints: MadangdTerminalRestoreHintStore
  /** This host's getHistoryRoot(). */
  shellHistoryRoot: string
  paneShellPath: () => string
  /** Defer without runtime evidence: shells surviving a restart could overwrite installed history. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
  deferredShellHistoryWorktreeIds: Set<string>
  paneWorktreeId: (paneKey: string) => string | null
  now: number
}

/** Retain failed blobs for retry; installed-migration markers prevent consumed hints from reviving. */
export function installMadangdMigrationReceivedBlobs(install: MadangdMigrationBlobInstall): void {
  let firstError: unknown = null
  // Keep failures independent so other blob kinds can still install.
  for (const installKind of [installTerminalRestoreHints, installShellHistory]) {
    try {
      installKind(install)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== null) {
    throw firstError
  }
}

function installShellHistory(install: MadangdMigrationBlobInstall): void {
  if (!install.worktreeHasLiveShells) {
    return
  }
  installMadangdMigrationShellHistory({
    migration: install.migration,
    root: install.root,
    historyRoot: install.shellHistoryRoot,
    paneShellPath: install.paneShellPath,
    worktreeHasLiveShells: install.worktreeHasLiveShells,
    deferredWorktreeIds: install.deferredShellHistoryWorktreeIds,
    now: install.now
  })
}

function installTerminalRestoreHints(install: MadangdMigrationBlobInstall): void {
  const path = getMadangdMigrationReceivedBlobPath(install.root, install.migration, {
    blobKind: 'terminal-restore-hints',
    key: MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY
  })
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return
  }
  const migrationKey = madangdMigrationStagingKey(install.migration)
  if (!install.terminalRestoreHints.hasInstalledMigration(migrationKey)) {
    try {
      const document = parseMadangdMigrationTerminalRestoreHintsText(decodeUtf8(bytes))
      install.terminalRestoreHints.install(
        { migrationKey, migrationId: install.migration.migrationId },
        placeHints(document.hints, install.paneWorktreeId),
        install.now
      )
    } catch (error) {
      if (!isHintFormatError(error)) {
        throw error
      }
      // Pre-commit validation passed; damaged hints can only fall back to the default folder now.
      console.error(
        `[madangd-migration] dropped unreadable terminal restore hints for ${install.migration.migrationId}:`,
        error
      )
    }
  }
  rmSync(path, { force: true })
  syncDirectoryDurablySync(dirname(path))
}

// Drop hints whose panes have no worktree on this host.
function placeHints(
  hints: readonly MadangdMigrationTerminalRestoreHint[],
  paneWorktreeId: (paneKey: string) => string | null
): MadangdTerminalRestoreHintPlacement[] {
  return hints.flatMap((hint) => {
    const worktreeId = paneWorktreeId(hint.paneKey)
    return worktreeId ? [{ ...hint, worktreeId }] : []
  })
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return UTF8.decode(bytes)
  } catch {
    throw new Error('madangd_migration_terminal_restore_hints_not_utf8')
  }
}

function isHintFormatError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('madangd_migration_terminal_restore_')
}
