import { useEffect } from 'react'
import { useAppStore } from '../store'
import {
  ensureCollaborationSkill,
  migrateLegacyCliSkill
} from '../lib/collaboration-skill-install'

/** Repair app-shipped skills after first paint: the collaboration stub while its switch is ON, and the legacy `orca-cli` rename. */
export function useBundledSkillSelfHeal(): void {
  const ready = useAppStore((s) => s.workspaceSessionReady)
  const collaborationOn = useAppStore((s) => s.settings?.experimentalCollaboration === true)

  useEffect(() => {
    if (!ready) {
      return
    }
    migrateLegacyCliSkill().catch((error: unknown) => {
      console.warn('[skills] legacy orca-cli migration failed', error)
    })
  }, [ready])

  useEffect(() => {
    if (ready && collaborationOn) {
      // Failures are kept in the collaboration skill state and shown in Settings.
      void ensureCollaborationSkill()
    }
  }, [ready, collaborationOn])
}
