// In-place WSL moves require the desktop-launched madangd in the source distro to own the unchanged paths.
import type { MadangdMigrationManifestSource } from '../../shared/madangd-migration/madangd-migration-manifest'
import { isMadangdMigrationLocalWslSource } from '../../shared/madangd-migration/madangd-migration-source-kind'
import { isWslHostMadangdProcess } from '../ipc/wsl-guest-windows-drive-path'

export const MADANGD_MIGRATION_SOURCE_NOT_THIS_HOST = 'madangd_migration_source_not_this_host'

/** Desktop-provided registry ID; guests cannot read it themselves. */
export const MADANGD_WSL_DISTRO_GUID_ENV = 'MADANG_WSL_DISTRO_GUID'

export function servesLocalWslMigrationSource(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  return isWslHostMadangdProcess(env, platform)
}

export function assertMadangdMigrationSourceServedHere(
  source: MadangdMigrationManifestSource,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): void {
  if (!isMadangdMigrationLocalWslSource(source)) {
    return
  }
  // WSL distro names and their UNC forms are case-insensitive.
  const distro = env.WSL_DISTRO_NAME?.trim().toLowerCase()
  if (!servesLocalWslMigrationSource(env, platform) || distro !== source.distro.toLowerCase()) {
    throw new Error(MADANGD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
  // Re-registering a distro reuses its name, not its files; require its registry ID when supplied.
  const guid = env[MADANGD_WSL_DISTRO_GUID_ENV]?.trim().toLowerCase()
  if (source.distroGuid !== undefined && guid !== source.distroGuid.toLowerCase()) {
    throw new Error(MADANGD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
}
