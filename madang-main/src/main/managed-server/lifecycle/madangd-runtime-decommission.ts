// Keep claims, tunnels and registration until the host proves server exit.
import type {
  MadangdManagedCancelStopResult,
  MadangdManagedForgetResult,
  MadangdManagedStopResult
} from '../../../shared/madangd-managed-runtime'
import type { MadangdDaemonRetirementVerdict } from '../../../shared/madangd-stop-request'
import { removeManagedMadangdEnvironment } from '../../../shared/runtime-environment-managed-madangd-store'
import type {
  KnownRuntimeEnvironment,
  MadangdSshDeploymentLink
} from '../../../shared/runtime-environments'
import { recoverInterruptedMadangdActivation } from '../activation/madangd-activation-recovery'
import { withStaleMadangdActivationRecoveryLock } from '../activation/madangd-activation-lock'
import { readMadangdActivationTransaction } from '../activation/madangd-activation-transaction-store'
import { reconcileMadangdDecommission } from './madangd-decommission-recovery'
import { cancelRemoteMadangdManagedStop } from './madangd-managed-remote-stop'
import {
  managedMadangdSlot,
  requireManagedMadangdInfrastructure,
  resolveLinkedMadangdContext
} from './madangd-managed-runtime-context'
import { closeMadangdManagedTunnel, ensureMadangdManagedTunnel } from './madangd-managed-tunnel'
import { clearManagedMadangdUpdateDeferral } from './madangd-managed-update-deferrals'
import { removeMadangdMigrationJournalsForDestination } from '../../ssh/madangd-migration-cutover-journal'
import { decommissionRemoteMadangd } from '../install/madangd-remote-decommission'
import { withManagedMadangdLifecycle } from '../../ssh/madangd-runtime-maintenance'
import { collectManagedTerminalCensus } from '../../ssh/madangd-terminal-census-client'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'

type ManagedMadangdStopPolicy = {
  isActiveEnvironment: (environmentId: string) => boolean
  retireLocalState: (environmentId: string) => Promise<void> | void
}

type Refusal = Extract<MadangdManagedStopResult, { outcome: 'refused' }>
type Stopped = { version: string | null; retirement: MadangdDaemonRetirementVerdict | null }

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

export function stopManagedMadangdEnvironment(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal },
  policy: ManagedMadangdStopPolicy
): Promise<MadangdManagedStopResult> {
  return withManagedMadangdLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    if (policy.isActiveEnvironment(environment.id)) {
      return refuse(
        'live',
        'madangd_stop_active_environment',
        'This server is the default host for new projects. Choose another one under New projects open on before stopping it.'
      )
    }
    const stopped = await stopRemote(userDataPath, environment, deployment, args.signal)
    if ('outcome' in stopped) {
      return stopped
    }
    await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
    return {
      outcome: 'unlinked',
      verdict: 'exited',
      environmentId: environment.id,
      sshTargetId: deployment.sshTargetId,
      stoppedVersion: stopped.version,
      retirement: stopped.retirement
    }
  })
}

/** Forget local state without assuming host exit; later connects may relink a still-running server. */
export function forgetManagedMadangdEnvironment(
  userDataPath: string,
  args: { selector: string },
  policy: ManagedMadangdStopPolicy
): Promise<MadangdManagedForgetResult> {
  return withManagedMadangdLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    if (policy.isActiveEnvironment(environment.id)) {
      return refuse(
        'live',
        'madangd_forget_active_environment',
        'This server is the default host for new projects. Choose another one under New projects open on before forgetting it.'
      )
    }
    await unlinkEnvironmentLocally(userDataPath, environment, deployment, policy)
    return {
      outcome: 'forgotten',
      verdict: 'unverifiable',
      environmentId: environment.id,
      sshTargetId: deployment.sshTargetId
    }
  })
}

async function stopRemote(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: MadangdSshDeploymentLink,
  signal?: AbortSignal,
  retried = false
): Promise<Stopped | Refusal> {
  const context = await resolveLinkedMadangdContext(environment, deployment, signal)
  const slot = managedMadangdSlot(context, deployment.remotePort, signal)
  const transaction = await readMadangdActivationTransaction(slot)
  if (transaction?.operation === 'decommission') {
    // Resume the exact interrupted stop from its journal.
    const recovered = await recoverInterruptedMadangdActivation(slot)
    if (recovered.outcome === 'recovered' && recovered.activeVersion === null) {
      return { version: transaction.activeVersion, retirement: null }
    }
    if (recovered.outcome === 'refused') {
      return refuse(recovered.verdict, recovered.code, recovered.reason)
    }
    if (recovered.outcome === 'pending') {
      return refuse('unverifiable', recovered.code, recovered.reason)
    }
    // Another run may settle recovery first; restart from its resulting record.
    if (recovered.outcome === 'none') {
      return retried
        ? refuse(
            'unverifiable',
            'madangd_stop_journal_changed',
            'Another run on this server changed its stop while this one waited. Refresh and retry.'
          )
        : stopRemote(userDataPath, environment, deployment, signal, true)
    }
    return refuse(
      'live',
      'madangd_stop_withdrawn',
      'The interrupted stop was withdrawn and the server keeps serving. Stop it again.'
    )
  }
  if (transaction) {
    return refuse(
      'unverifiable',
      'madangd_activation_recovery_required',
      'An earlier update on this server was interrupted. Recover it before stopping.'
    )
  }
  const record = context.activationRecord
  if (!record.active) {
    return { version: null, retirement: null }
  }
  const census = await collectManagedTerminalCensus(userDataPath, environment, record)
  const result = await decommissionRemoteMadangd({ ...slot, record, census })
  if (result.outcome === 'refused') {
    return refuse(result.verdict, result.code, result.reason)
  }
  return { version: result.version, retirement: result.retirement }
}

async function unlinkEnvironmentLocally(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  deployment: MadangdSshDeploymentLink,
  policy: ManagedMadangdStopPolicy
): Promise<void> {
  // Remove registration before releasing claims so crashes leave a resumable hidden target.
  removeManagedMadangdEnvironment(userDataPath, environment.id)
  await policy.retireLocalState(environment.id)
  await closeMadangdManagedTunnel(environment.id)
  const { claims } = requireManagedMadangdInfrastructure()
  claims.release(deployment.sshTargetId, environment.id)
  clearManagedMadangdUpdateDeferral(environment.id)
  await claims.flush()
  // Clear journals after the fence; stale leftovers are recoverable on later conversion.
  removeMadangdMigrationJournalsForDestination(userDataPath, deployment.sshTargetId, environment.id)
}

export function cancelManagedMadangdStop(
  userDataPath: string,
  args: { selector: string; signal?: AbortSignal }
): Promise<MadangdManagedCancelStopResult> {
  return withManagedMadangdLifecycle(userDataPath, args.selector, async (managed) => {
    const { environment, deployment } = managed
    const context = await resolveLinkedMadangdContext(environment, deployment, args.signal)
    const slot = managedMadangdSlot(context, deployment.remotePort, args.signal)
    let result: MadangdManagedCancelStopResult
    try {
      result = await withStaleMadangdActivationRecoveryLock(slot, async (lock) => {
        const transaction = await readMadangdActivationTransaction(slot)
        if (transaction?.operation !== 'decommission') {
          if (transaction) {
            lock.retain()
          }
          return { outcome: 'none' }
        }
        if (transaction.phase === 'process-exited') {
          lock.retain()
          return { outcome: 'already-stopped' }
        }
        if (transaction.request) {
          const cancellation = await cancelRemoteMadangdManagedStop(slot, transaction.request)
          if (cancellation.outcome !== 'canceled') {
            lock.retain()
            return {
              outcome: 'refused',
              verdict: 'live',
              code: 'madangd_stop_already_dispatched',
              reason: 'madangd already acted on the stop and is shutting down; it cannot be canceled.'
            }
          }
        }
        const kept = await reconcileMadangdDecommission(slot, {
          action: 'keep-serving',
          version: transaction.activeVersion
        })
        if (kept.outcome !== 'recovered' || !kept.activeVersion) {
          lock.retain()
          return {
            outcome: 'refused',
            verdict: 'unverifiable',
            code: 'madangd_stop_cancel_unverifiable',
            reason: 'The stop was withdrawn but the server could not be shown to be serving.'
          }
        }
        return { outcome: 'canceled', activeVersion: kept.activeVersion }
      })
    } catch (error) {
      if (error instanceof RemoteInstallLockBusyError) {
        return {
          outcome: 'refused',
          verdict: 'unverifiable',
          code: 'madangd_stop_still_running',
          reason: 'A stop on this server may still be running. Retry after it settles.'
        }
      }
      throw error
    }
    if (result.outcome === 'canceled') {
      await ensureMadangdManagedTunnel(userDataPath, environment.id)
    }
    return result
  })
}
