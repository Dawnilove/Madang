import {
  cancelManagedMadangdStop,
  forgetManagedMadangdEnvironment,
  stopManagedMadangdEnvironment
} from '../../managed-server/lifecycle/madangd-runtime-decommission'
import { getManagedMadangdRuntimeStatus } from '../../managed-server/lifecycle/madangd-runtime-status'
import {
  recoverManagedMadangdEnvironment,
  rollbackManagedMadangdEnvironment,
  updateManagedMadangdEnvironment
} from '../../ssh/madangd-runtime-maintenance'
import { getMadangdSshDeployment } from '../../../shared/runtime-environments'
import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import type {
  MadangdManagedRestartResult,
  MadangdManagedStaleLockReclaimRequest,
  MadangdManagedStaleLockReclaimResult
} from '../../../shared/madangd-managed-runtime'
import { restartManagedMadangdEnvironment } from '../../managed-server/lifecycle/madangd-managed-launch-session'
import { runManagedMadangdStaleLockReclaim } from '../../managed-server/lifecycle/madangd-managed-stale-lock-reclaim'
import { clearLaunchSessionNote } from './runtime-environment-managed-tunnel'
import { forgetLaunchSessionVerdict } from '../ssh/ssh-host-launch-session-note'
import type { ManagedServerActions } from '../../runtime/managed-server-actions-registry'
import {
  retireRemovedRuntimeEnvironment,
  type RemovedServerStore
} from './runtime-environment-removal-cleanup'

export type ManagedMadangdActionOptions = {
  getUserDataPath: () => string
  getActiveEnvironmentId: () => string | null | undefined
  invalidateTransport: (environmentId: string) => Promise<void> | void
  clearHostServerNotes: (sshTargetId: string, environmentId: string) => void
  clearHostServerStatus: (sshTargetId: string) => void
  store: RemovedServerStore
}

export function createManagedMadangdActions(
  options: ManagedMadangdActionOptions
): ManagedServerActions {
  const userDataPath = options.getUserDataPath
  const unlinkPolicy = {
    isActiveEnvironment: (environmentId: string) =>
      options.getActiveEnvironmentId() === environmentId,
    retireLocalState: (environmentId: string) =>
      retireRemovedRuntimeEnvironment(
        environmentId,
        options.invalidateTransport,
        options.store,
        userDataPath()
      )
  }
  return {
    status: (selector) => getManagedMadangdRuntimeStatus(userDataPath(), selector),
    update: async (selector, force, pastLiveTerminals) => {
      const result = await updateManagedMadangdEnvironment(userDataPath(), {
        selector,
        force,
        ...(pastLiveTerminals ? { pastLiveTerminals } : {})
      })
      if (result.outcome === 'updated') {
        await options.invalidateTransport(result.environment.id)
      }
      if (result.outcome !== 'deferred') {
        const targetId = getMadangdSshDeployment(result.environment)?.sshTargetId
        if (targetId) {
          options.clearHostServerNotes(targetId, result.environment.id)
        }
      }
      return result
    },
    rollback: async (selector) => {
      const result = await rollbackManagedMadangdEnvironment(userDataPath(), { selector })
      if (result.outcome === 'rolled-back') {
        await options.invalidateTransport(result.environment.id)
      }
      return result
    },
    recover: async (selector, acceptChangedState) => {
      const result = await recoverManagedMadangdEnvironment(userDataPath(), {
        selector,
        acceptChangedState: acceptChangedState === true
      })
      if (result.outcome === 'recovered' && result.activeVersion) {
        await options.invalidateTransport(result.environment.id)
      }
      return result
    },
    stop: async (selector) => {
      const result = await stopManagedMadangdEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'unlinked') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    },
    cancelStop: (selector) => cancelManagedMadangdStop(userDataPath(), { selector }),
    forget: async (selector) => {
      const result = await forgetManagedMadangdEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'forgotten') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    }
  }
}

export async function restartManagedMadangd(
  options: ManagedMadangdActionOptions,
  selector: string
): Promise<MadangdManagedRestartResult> {
  const result = await restartManagedMadangdEnvironment(options.getUserDataPath(), selector)
  if (result.outcome === 'restarted') {
    await reconnectRestartedManagedMadangd(options, result.environmentId)
  }
  return result
}

export async function reclaimManagedMadangdStaleLock(
  options: ManagedMadangdActionOptions,
  selector: string,
  request: MadangdManagedStaleLockReclaimRequest
): Promise<MadangdManagedStaleLockReclaimResult> {
  const result = await runManagedMadangdStaleLockReclaim(options.getUserDataPath(), selector, request)
  // Reconnect also replaces stale-lock feedback when no process had started.
  if (result.status === 'reclaimed') {
    await reconnectRestartedManagedMadangd(options, result.environmentId)
  }
  return result
}

async function reconnectRestartedManagedMadangd(
  options: ManagedMadangdActionOptions,
  environmentId: string
): Promise<void> {
  await options.invalidateTransport(environmentId)
  const environment = resolveEnvironment(options.getUserDataPath(), environmentId)
  const targetId = getMadangdSshDeployment(environment)?.sshTargetId
  if (targetId) {
    options.clearHostServerNotes(targetId, environmentId)
    forgetLaunchSessionVerdict(targetId)
    clearLaunchSessionNote(targetId, environmentId)
  }
}
