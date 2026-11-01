import type { ProfileStateStorageClassification } from '../persistence/profile-state/profile-state-storage-classification'

/** Exclude paths, profile IDs and serialized state from fleet telemetry. */
export type MadangdProfileStateAuthoritySelection = {
  backend: 'sqlite'
  classification: ProfileStateStorageClassification
  authority_mode: 'sqlite-established'
  runtime: 'madangd'
  migrated: boolean
}

type MadangdProfileStateTelemetrySink = (line: string) => void

export function formatMadangdProfileStateAuthoritySelected(
  selection: MadangdProfileStateAuthoritySelection
): string {
  // Select fields explicitly so structural typing cannot leak extra runtime data.
  return `[madangd-telemetry] ${JSON.stringify({
    event: 'profile_state_authority_selected',
    backend: selection.backend,
    classification: selection.classification,
    authority_mode: selection.authority_mode,
    runtime: selection.runtime,
    migrated: selection.migrated
  })}`
}

/** Use stderr without desktop dependencies; telemetry failures must not block serving. */
export function emitMadangdProfileStateAuthoritySelected(
  selection: MadangdProfileStateAuthoritySelection,
  sink: MadangdProfileStateTelemetrySink = (line) => console.error(line)
): void {
  try {
    sink(formatMadangdProfileStateAuthoritySelected(selection))
  } catch {}
}
