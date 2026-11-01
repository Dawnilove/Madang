/** Managed madangd servers over SSH; desktop-only, so web clients leave it undefined. */
import { ipcRenderer } from 'electron'
import type {
  MadangdDeltaMovePreview,
  MadangdDeltaMoveResult,
  MadangdManagedCancelStopResult,
  MadangdManagedConversionResult,
  MadangdManagedDeployResult,
  MadangdManagedForgetResult,
  MadangdManagedPastLiveTerminals,
  MadangdManagedPendingMigrationRow,
  MadangdManagedRecoveryResult,
  MadangdManagedRestartResult,
  MadangdManagedStaleLockReclaimRequest,
  MadangdManagedStaleLockReclaimResult,
  MadangdManagedRollbackResult,
  MadangdManagedRuntimeStatus,
  MadangdManagedStopResult
} from '../../shared/madangd-managed-runtime'
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type {
  RuntimeSshAccessLinkRequest,
  RuntimeSshAccessUnlinkRequest
} from '../../shared/runtime-ssh-access'

export type ManagedMadangdPreloadApi = {
  deploy: (args: {
    name: string
    sshTargetId: string
    force?: boolean
  }) => Promise<MadangdManagedDeployResult>
  getStatus: (args: { selector: string }) => Promise<MadangdManagedRuntimeStatus>
  update: (args: {
    selector: string
    force?: boolean
    pastLiveTerminals?: MadangdManagedPastLiveTerminals
  }) => Promise<MadangdManagedDeployResult>
  rollback: (args: { selector: string }) => Promise<MadangdManagedRollbackResult>
  recover: (args: {
    selector: string
    /** Restore the snapshot over state a rejected build changed; see MADANGD_RECOVERY_CHANGED_STATE_CODE. */
    acceptChangedState?: boolean
  }) => Promise<MadangdManagedRecoveryResult>
  /** Restarts from this client's SSH session; refused while terminals run. */
  restart: (args: { selector: string }) => Promise<MadangdManagedRestartResult>
  /** Without `yes`, only reports whether the host's instance lock may be cleared. */
  reclaimStaleLock: (
    args: { selector: string } & MadangdManagedStaleLockReclaimRequest
  ) => Promise<MadangdManagedStaleLockReclaimResult>
  stop: (args: { selector: string }) => Promise<MadangdManagedStopResult>
  cancelStop: (args: { selector: string }) => Promise<MadangdManagedCancelStopResult>
  forget: (args: { selector: string }) => Promise<MadangdManagedForgetResult>
  linkSshAccess: (args: RuntimeSshAccessLinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  unlinkSshAccess: (args: RuntimeSshAccessUnlinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  convertSshHost: (args: {
    sshTargetId: string
    name: string
  }) => Promise<MadangdManagedConversionResult>
  listPendingMigrations: () => Promise<MadangdManagedPendingMigrationRow[]>
  previewDeltaMove: (args: { sshTargetId: string }) => Promise<MadangdDeltaMovePreview>
  moveDelta: (args: { sshTargetId: string }) => Promise<MadangdDeltaMoveResult>
  keepServerVersion: (args: { sshTargetId: string }) => Promise<void>
  /** "Move anyway": the next connect leaves what can't move on this desktop. */
  allowMoveLeavingBehind: (args: { sshTargetId: string }) => Promise<void>
}

export const managedMadangdApi: ManagedMadangdPreloadApi = {
  deploy: (args) => ipcRenderer.invoke('runtimeEnvironments:deployMadangd', args),
  getStatus: (args) => ipcRenderer.invoke('runtimeEnvironments:getMadangdStatus', args),
  update: (args) => ipcRenderer.invoke('runtimeEnvironments:updateMadangd', args),
  rollback: (args) => ipcRenderer.invoke('runtimeEnvironments:rollbackMadangd', args),
  recover: (args) => ipcRenderer.invoke('runtimeEnvironments:recoverMadangd', args),
  restart: (args) => ipcRenderer.invoke('runtimeEnvironments:restartMadangd', args),
  reclaimStaleLock: (args) => ipcRenderer.invoke('runtimeEnvironments:reclaimMadangdStaleLock', args),
  stop: (args) => ipcRenderer.invoke('runtimeEnvironments:stopMadangd', args),
  cancelStop: (args) => ipcRenderer.invoke('runtimeEnvironments:cancelMadangdStop', args),
  forget: (args) => ipcRenderer.invoke('runtimeEnvironments:forgetMadangd', args),
  linkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:linkSshAccess', args),
  unlinkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:unlinkSshAccess', args),
  convertSshHost: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:convertSshHostToManagedMadangd', args),
  listPendingMigrations: () => ipcRenderer.invoke('runtimeEnvironments:listPendingMadangdMigrations'),
  previewDeltaMove: (args) => ipcRenderer.invoke('runtimeEnvironments:previewMadangdDeltaMove', args),
  moveDelta: (args) => ipcRenderer.invoke('runtimeEnvironments:moveMadangdDelta', args),
  keepServerVersion: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:keepMadangdServerVersion', args),
  allowMoveLeavingBehind: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:allowMadangdMoveLeavingBehind', args)
}
