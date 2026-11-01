/** Legacy SSH omits source.kind to preserve signed bytes/digests. Other kinds must set kind and omit sshTargetId:
 * older destinations strip unknown fields, then fail parsing instead of importing a non-SSH source as SSH. */
import type {
  MadangdMigrationLocalWslManifestSource,
  MadangdMigrationManifestSource,
  MadangdMigrationSshManifestSource
} from './madangd-migration-manifest'
import { MADANGD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY } from '../madangd-runtime-capabilities'

export const MADANGD_MIGRATION_SSH_RELAY_SOURCE_KIND = 'ssh-relay' as const

/** Non-SSH kinds and the destination capability that proves a destination parses each one. */
export const MADANGD_MIGRATION_SOURCE_KIND_CAPABILITIES = {
  'local-wsl': MADANGD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
} as const

export type MadangdMigrationNonSshSourceKind = keyof typeof MADANGD_MIGRATION_SOURCE_KIND_CAPABILITIES
export type MadangdMigrationSourceKind =
  | typeof MADANGD_MIGRATION_SSH_RELAY_SOURCE_KIND
  | MadangdMigrationNonSshSourceKind

export const MADANGD_MIGRATION_SOURCE_KIND_UNKNOWN = 'madangd_migration_source_kind_unknown'

/** A manifest source as it travels: this build may not know every field a newer peer signed. */
export type MadangdMigrationWireSource = Readonly<Record<string, unknown>>

export function madangdMigrationManifestSourceKind(
  source: MadangdMigrationWireSource
): MadangdMigrationSourceKind {
  if (source.kind === undefined) {
    return MADANGD_MIGRATION_SSH_RELAY_SOURCE_KIND
  }
  // An explicit 'ssh-relay' is refused too: SSH has exactly one encoding, so one digest.
  if (isNonSshSourceKind(source.kind)) {
    return source.kind
  }
  throw new Error(MADANGD_MIGRATION_SOURCE_KIND_UNKNOWN)
}

function isNonSshSourceKind(kind: unknown): kind is MadangdMigrationNonSshSourceKind {
  return typeof kind === 'string' && Object.hasOwn(MADANGD_MIGRATION_SOURCE_KIND_CAPABILITIES, kind)
}

/** The capability a destination must advertise before it may see this source; null for SSH. */
export function requiredMadangdMigrationSourceCapability(
  source: MadangdMigrationWireSource
): string | null {
  const kind = madangdMigrationManifestSourceKind(source)
  return kind === MADANGD_MIGRATION_SSH_RELAY_SOURCE_KIND
    ? null
    : MADANGD_MIGRATION_SOURCE_KIND_CAPABILITIES[kind]
}

export function isMadangdMigrationLocalWslSource(
  source: MadangdMigrationManifestSource
): source is MadangdMigrationLocalWslManifestSource {
  return 'kind' in source && source.kind === 'local-wsl'
}

/** For the SSH conversion's own steps: a WSL manifest reaching them is a bug, never a fallback. */
export function requireMadangdMigrationSshSource(
  source: MadangdMigrationManifestSource
): MadangdMigrationSshManifestSource {
  if (isMadangdMigrationLocalWslSource(source)) {
    throw new Error('madangd_migration_source_not_ssh')
  }
  return source
}
