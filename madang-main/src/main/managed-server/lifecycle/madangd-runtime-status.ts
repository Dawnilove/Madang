import type { MadangdManagedRuntimeStatus } from '../../../shared/madangd-managed-runtime'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import type { MadangdActivationTransaction } from '../activation/madangd-activation-transaction'
import { readMadangdActivationTransaction } from '../activation/madangd-activation-transaction-store'
import {
  requireManagedMadangdEnvironment,
  resolveLinkedMadangdContext
} from './madangd-managed-runtime-context'
import { currentManagedMadangdUpdateDeferral } from './madangd-managed-update-deferrals'
import { findIncompleteManagedMadangdMigration } from './madangd-managed-migration-status'
import { collectManagedTerminalCensus } from '../../ssh/madangd-terminal-census-client'
import { getAppEnvironment } from '../../../shared/app-environment'
import { bundledManagedMadangdVersion } from './madangd-managed-auto-update'
import { availableManagedMadangdUpdate } from './madangd-managed-update-decision'

/** Read host records without repairing them. */
export async function getManagedMadangdRuntimeStatus(
  userDataPath: string,
  selector: string,
  signal?: AbortSignal
): Promise<MadangdManagedRuntimeStatus> {
  const { environment, deployment } = requireManagedMadangdEnvironment(userDataPath, selector)
  const { status, record, serverTarget } = await runTargetLifecycle(
    deployment.sshTargetId,
    async () => {
      const context = await resolveLinkedMadangdContext(environment, deployment, signal)
      const record = context.activationRecord
      const transaction = await readMadangdActivationTransaction({
        conn: context.connection,
        host: context.host,
        remoteHome: context.remoteHome,
        signal
      })
      const status: MadangdManagedRuntimeStatus = {
        environmentId: environment.id,
        sshTargetId: context.target.id,
        activeVersion: record.active,
        activeAppVersion: record.active ? (record.activeAppVersion ?? null) : null,
        previousVersion: record.previous,
        activatedAt: record.activatedAt,
        rollbackAvailable: Boolean(record.previous && record.snapshot),
        recovery: transaction ? managedRecoveryStatus(transaction) : null,
        terminals: await collectManagedTerminalCensus(userDataPath, environment, record),
        migration: migrationStatus(userDataPath, environment.id),
        deferredUpdate: currentManagedMadangdUpdateDeferral(environment.id, record.active)
      }
      return { status, record, serverTarget: context.serverTarget }
    }
  )
  // Outside the host queue: hashing the local template must not hold up host actions.
  // A local template fault hides only the offer, never the host's status.
  const candidateVersion = await bundledManagedMadangdVersion(serverTarget).catch(() => null)
  return {
    ...status,
    availableUpdate: availableManagedMadangdUpdate({
      record,
      candidateVersion,
      appVersion: getAppEnvironment().getVersion(),
      deferredCandidateVersion: status.deferredUpdate?.candidateVersion ?? null
    })
  }
}

function managedRecoveryStatus(
  transaction: MadangdActivationTransaction
): NonNullable<MadangdManagedRuntimeStatus['recovery']> {
  switch (transaction.operation) {
    case 'activate':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.candidateVersion,
        startedAt: transaction.startedAt
      }
    case 'rollback':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.targetVersion,
        startedAt: transaction.startedAt
      }
    case 'decommission':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.activeVersion,
        startedAt: transaction.startedAt
      }
  }
}

function migrationStatus(
  userDataPath: string,
  environmentId: string
): MadangdManagedRuntimeStatus['migration'] {
  const migration = findIncompleteManagedMadangdMigration(userDataPath, environmentId)
  return migration
    ? { migrationId: migration.migrationId, phase: migration.phase, startedAt: migration.startedAt }
    : null
}
