import {
  isRetainedMadangdMigrationSourceCutover,
  type MadangdMigrationSourceCutover
} from '../../../shared/madangd-migration/madangd-migration-source-cutover'
import {
  getMadangdSshDeployment,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { listMadangdMigrationSourceCutovers } from '../../ssh/madangd-migration-cutover-journal'

type MadangdManagedPendingMigration = {
  migrationId: string
  environmentId: string
  name: string
  sshTargetId: string
  phase: MadangdMigrationSourceCutover['phase']
  startedAt: string
}

/** Unreadable journals must not look like absent migrations. */
export function listPendingManagedMadangdMigrations(
  userDataPath: string
): MadangdManagedPendingMigration[] {
  return (
    listMadangdMigrationSourceCutovers(userDataPath)
      // Committed/retained journals preserve downgrade recovery, not pending migration work.
      .filter(
        (cutover) =>
          cutover.phase !== 'source-retired' && !isRetainedMadangdMigrationSourceCutover(cutover)
      )
      .map((cutover) => ({
        migrationId: cutover.migrationId,
        environmentId: cutover.destinationEnvironmentId,
        name: cutover.destinationName,
        sshTargetId: cutover.sshTargetId,
        phase: cutover.phase,
        startedAt: cutover.startedAt
      }))
  )
}

export function findIncompleteManagedMadangdMigration(
  userDataPath: string,
  environmentId: string
): MadangdManagedPendingMigration | null {
  return (
    listPendingManagedMadangdMigrations(userDataPath).find(
      (migration) => migration.environmentId === environmentId
    ) ?? null
  )
}

export function environmentMatchesManagedMadangdCutover(
  environment: KnownRuntimeEnvironment,
  cutover: MadangdMigrationSourceCutover
): boolean {
  const deployment = getMadangdSshDeployment(environment)
  return (
    environment.id === cutover.destinationEnvironmentId &&
    environment.name === cutover.destinationName &&
    deployment?.sshTargetId === cutover.sshTargetId &&
    deployment.sshTargetGeneration === cutover.sshTargetGeneration
  )
}
