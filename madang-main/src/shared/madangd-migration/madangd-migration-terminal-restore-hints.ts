/** One terminal-restore-hints JSON blob restores moved panes’ source cwd. Format changes require a new capability. */
import { z } from 'zod'
import { MAX_PANE_KEY_LEN } from '../agent-hook-listener/listener-limits'
import { MADANGD_MIGRATION_BLOB_KIND_CONTRACTS } from './madangd-migration-blob-transfer'
import { parsePaneKey } from '../stable-pane-id'

export const MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION = 1
export const MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY = 'migration'
export const MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS = 8192
// Linux PATH_MAX; a longer cwd cannot be a directory a shell could have been in.
export const MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINT_CWD_LENGTH = 4096
export const MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES =
  MADANGD_MIGRATION_BLOB_KIND_CONTRACTS['terminal-restore-hints'].maxBytes

export type MadangdMigrationTerminalRestoreHint = { paneKey: string; cwd: string }

export type MadangdMigrationTerminalRestoreHintsDocument = {
  version: typeof MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION
  hints: MadangdMigrationTerminalRestoreHint[]
}

export function isMadangdMigrationTerminalRestoreHintPaneKey(value: string): boolean {
  return value.length <= MAX_PANE_KEY_LEN && parsePaneKey(value) !== null
}

/** Absolute POSIX; `//` is refused because a UNC-style spelling never names a distro path. */
export function isMadangdMigrationTerminalRestoreHintCwd(value: string): boolean {
  return (
    value.length <= MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINT_CWD_LENGTH &&
    /^\/(?!\/)/.test(value) &&
    !value.includes('\0')
  )
}

const HintSchema = z.object({
  paneKey: z.string().refine(isMadangdMigrationTerminalRestoreHintPaneKey, {
    message: 'madangd_migration_terminal_restore_hint_pane_key_invalid'
  }),
  cwd: z.string().refine(isMadangdMigrationTerminalRestoreHintCwd, {
    message: 'madangd_migration_terminal_restore_hint_cwd_invalid'
  })
})

// Not strict: a same-version sender may add optional fields this build ignores.
export const MadangdMigrationTerminalRestoreHintsDocumentSchema = z
  .object({
    version: z.literal(MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION),
    hints: z.array(HintSchema).max(MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS)
  })
  .superRefine((value, context) => {
    const seen = new Set<string>()
    for (const hint of value.hints) {
      if (seen.has(hint.paneKey)) {
        context.addIssue({
          code: 'custom',
          message: 'madangd_migration_terminal_restore_hint_duplicate'
        })
        return
      }
      seen.add(hint.paneKey)
    }
  })

export function parseMadangdMigrationTerminalRestoreHintsDocument(
  value: unknown
): MadangdMigrationTerminalRestoreHintsDocument {
  const parsed = MadangdMigrationTerminalRestoreHintsDocumentSchema.safeParse(value)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? ''
    // Zod's own messages (wrong version, missing field) collapse into one stable code.
    throw new Error(
      message.startsWith('madangd_migration_terminal_restore_')
        ? message
        : 'madangd_migration_terminal_restore_hints_invalid'
    )
  }
  return {
    version: parsed.data.version,
    hints: parsed.data.hints.map((hint) => ({ paneKey: hint.paneKey, cwd: hint.cwd }))
  }
}

export function parseMadangdMigrationTerminalRestoreHintsText(
  text: string
): MadangdMigrationTerminalRestoreHintsDocument {
  if (text.length > MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES) {
    throw new Error('madangd_migration_terminal_restore_hints_too_large')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('madangd_migration_terminal_restore_hints_not_json')
  }
  return parseMadangdMigrationTerminalRestoreHintsDocument(value)
}
