import { describe, expect, it } from 'vitest'
import {
  MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS,
  MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES,
  parseMadangdMigrationTerminalRestoreHintsDocument,
  parseMadangdMigrationTerminalRestoreHintsText
} from './madangd-migration-terminal-restore-hints'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

function document(hints: unknown[]): unknown {
  return { version: 1, hints }
}

describe('terminal restore hints document', () => {
  it('accepts stable pane keys with absolute POSIX folders and drops unknown fields', () => {
    expect(
      parseMadangdMigrationTerminalRestoreHintsDocument({
        version: 1,
        hints: [{ paneKey: PANE_KEY, cwd: '/home/me/src', extra: true }],
        futureField: 1
      })
    ).toEqual({ version: 1, hints: [{ paneKey: PANE_KEY, cwd: '/home/me/src' }] })
  })

  it.each([
    ['a legacy numeric pane id', 'tab-1:3'],
    ['a key without a tab', ':11111111-1111-4111-8111-111111111111'],
    ['a key with two separators', 'a:b:11111111-1111-4111-8111-111111111111'],
    ['an over-long key', `${'t'.repeat(200)}:11111111-1111-4111-8111-111111111111`]
  ])('refuses %s', (_label, paneKey) => {
    expect(() =>
      parseMadangdMigrationTerminalRestoreHintsDocument(document([{ paneKey, cwd: '/home' }]))
    ).toThrow('madangd_migration_terminal_restore_hint_pane_key_invalid')
  })

  it.each([
    ['a relative folder', 'src/app'],
    ['a UNC-style folder', '//wsl.localhost/Ubuntu/home'],
    ['a Windows folder', 'C:\\Users\\me'],
    ['a folder with NUL', '/home/\0me'],
    ['an over-long folder', `/${'a'.repeat(4096)}`]
  ])('refuses %s', (_label, cwd) => {
    expect(() =>
      parseMadangdMigrationTerminalRestoreHintsDocument(document([{ paneKey: PANE_KEY, cwd }]))
    ).toThrow('madangd_migration_terminal_restore_hint_cwd_invalid')
  })

  it('refuses duplicate panes, too many hints, other versions and non-JSON', () => {
    const hint = { paneKey: PANE_KEY, cwd: '/home' }
    expect(() => parseMadangdMigrationTerminalRestoreHintsDocument(document([hint, hint]))).toThrow(
      'madangd_migration_terminal_restore_hint_duplicate'
    )
    expect(() =>
      parseMadangdMigrationTerminalRestoreHintsDocument(
        document(Array.from({ length: MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS + 1 }, () => hint))
      )
    ).toThrow('madangd_migration_terminal_restore_hints_invalid')
    expect(() =>
      parseMadangdMigrationTerminalRestoreHintsDocument({ version: 2, hints: [] })
    ).toThrow('madangd_migration_terminal_restore_hints_invalid')
    expect(() => parseMadangdMigrationTerminalRestoreHintsText('{')).toThrow(
      'madangd_migration_terminal_restore_hints_not_json'
    )
  })

  it('refuses text over the blob cap before parsing it', () => {
    expect(() =>
      parseMadangdMigrationTerminalRestoreHintsText(
        ' '.repeat(MAX_MADANGD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES + 1)
      )
    ).toThrow('madangd_migration_terminal_restore_hints_too_large')
  })
})
