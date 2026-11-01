import { describe, expect, it } from 'vitest'
import { madangdMigrationConflictGuidance } from './madangd-migration-conflict-guidance'

const NO_DESKTOP_STEP = [
  'project_group_id',
  'folder_workspace_id',
  'dormant_id',
  'dormant_focus',
  'client_state',
  'close_intent_destination',
  'snapshot_destination'
]

describe('madangd migration conflict guidance', () => {
  // This guidance also reaches clients without a plain SSH terminal.
  it('names the code for every conflict retrying can’t clear, and no client-only action', () => {
    for (const kind of NO_DESKTOP_STEP) {
      const text = madangdMigrationConflictGuidance(
        new Error(`madangd_migration_${kind}_conflict:ui:workspaceHostScope`)
      )
      expect(text).toContain('Retrying won’t clear it.')
      expect(text).not.toContain('plain SSH')
      expect(text).toContain(`madangd_migration_${kind}_conflict`)
    }
  })

  it('keeps the specific way out where the desktop has one', () => {
    expect(
      madangdMigrationConflictGuidance(
        new Error('madangd_migration_repository_path_conflict:/home/me/app')
      )
    ).toContain('remove that project from this desktop and connect again')
  })

  it('is null for anything that is not a conflict', () => {
    expect(madangdMigrationConflictGuidance(new Error('ECONNRESET'))).toBeNull()
  })
})
