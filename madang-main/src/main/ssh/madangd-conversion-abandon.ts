/** Registered destinations must abort/prove empty, then unregister before fence release so later starts cannot reclaim the host. Never-registered destinations held nothing. */
import { removeManagedMadangdEnvironment } from '../../shared/runtime-environment-managed-madangd-store'
import { listEnvironments } from '../../shared/runtime-environment-store'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import { closeMadangdManagedTunnel } from '../managed-server/lifecycle/madangd-managed-tunnel'
import {
  abortMadangdMigrationCutover,
  type MadangdMigrationAbortResult,
  type MadangdMigrationCutoverContext,
  type MadangdMigrationDestinationCatalog
} from './madangd-migration-cutover-coordinator'
import { findMadangdMigrationSourceCutoverForTarget } from './madangd-migration-cutover-journal'
import {
  releaseMadangdMigrationFence,
  releaseUndeployedMigrationFence
} from './madangd-migration-source-fence'

export async function abandonMadangdConversion(args: {
  userDataPath: string
  store: MadangdMigrationCutoverContext['store']
  claims: MadangdMigrationCutoverContext['claims']
  targetId: string
  destinationFor: (environment: KnownRuntimeEnvironment) => MadangdMigrationDestinationCatalog
}): Promise<MadangdMigrationAbortResult | 'none'> {
  const cutover = findMadangdMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Committed delta chains resolve only through the delta flow.
  if (!cutover || cutover.supersedesMigrationId) {
    return 'none'
  }
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  const environment = listEnvironments(args.userDataPath).find(
    (entry) => entry.id === cutover.destinationEnvironmentId
  )
  if (!environment) {
    await releaseUndeployedMigrationFence({ ...args, isDestinationRegistered: isRegistered })
    return 'none'
  }
  const context = { ...args, destination: args.destinationFor(environment) }
  return abortMadangdMigrationCutover(context, cutover.migrationId, async (aborted) => {
    await closeMadangdManagedTunnel(environment.id).catch(() => undefined)
    removeManagedMadangdEnvironment(args.userDataPath, environment.id)
    await releaseMadangdMigrationFence(context, aborted)
  })
}
