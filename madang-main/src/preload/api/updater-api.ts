import type {
  LinuxPackageInstallInstructions,
  ReleaseBuildListResult,
  UpdateCheckOptions,
  UpdateStatus
} from '../../shared/update-status-types'
import type { ReleaseChannel } from '../../shared/release-channel'
import type { ReleaseNotes } from '../../shared/whats-new'

export type UpdaterApi = {
  getVersion: () => Promise<string>
  /** Release notes of the running version from GitHub; null in dev builds, offline or on any error. */
  getReleaseNotes: () => Promise<ReleaseNotes | null>
  getStatus: () => Promise<UpdateStatus>
  check: (options?: UpdateCheckOptions) => Promise<void>
  download: () => Promise<void>
  quitAndInstall: () => Promise<void>
  dismissNudge: () => Promise<void>
  dismissAvailableUpdate: () => Promise<void>
  /** Desktop-only. Rejects unless the current status carries `linux-package-install` recovery. */
  getLinuxPackageInstallInstructions: () => Promise<LinuxPackageInstallInstructions>
  /** Desktop-only. Reveals the revalidated cached package in the native file manager. */
  showLinuxPackage: () => Promise<void>
  /** Use force to bypass the cache only for an explicit refresh. */
  listBuilds: (
    channel: ReleaseChannel,
    options?: { force?: boolean }
  ) => Promise<ReleaseBuildListResult>

  onStatus: (callback: (status: UpdateStatus) => void) => () => void
  onClearDismissal: (callback: () => void) => () => void
}
