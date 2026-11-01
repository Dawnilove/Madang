/** Release conversion setups stranded before staging by refused SSH forwarding. Stop any activated slot, unregister, then use undeployed-fence release; source rows remain intact for retry. */
import { listEnvironments } from '../../shared/runtime-environment-store'
import { removeManagedMadangdEnvironment } from '../../shared/runtime-environment-managed-madangd-store'
import { findMadangdMigrationSourceCutoverForTarget } from './madangd-migration-cutover-journal'
import { releaseUndeployedMigrationFence } from './madangd-migration-source-fence'
import { closeMadangdManagedTunnel } from '../managed-server/lifecycle/madangd-managed-tunnel'
import type { SshTargetMadangdClaims } from './targets/ssh-target-madangd-claims'
import { withMadangdActivationLock } from '../managed-server/activation/madangd-activation-lock'
import { withDeactivatedVersionCommitted } from '../managed-server/activation/madangd-activation-record'
import {
  readMadangdActivationRecord,
  writeMadangdActivationRecord
} from '../managed-server/activation/madangd-activation-record-store'
import { managedMadangdSlot } from '../managed-server/lifecycle/madangd-managed-runtime-context'
import { resolveMadangdRemoteContext } from '../managed-server/install/madangd-remote-context'
import { madangdStopFreedTheHost } from '../managed-server/install/madangd-remote-process-control'
import { madangdSlotDir, stopMadangdSlot } from './madangd-recovery-slot'
import { sshMadangdHostTransport } from './madangd-ssh-host-transport'
import { getSshConnectionManager, getSshTargetRegistryStore } from './targets/ssh-target-registry'
import { errorMessage } from '../../shared/error-message'

export async function releaseUnreachableMadangdSetup(args: {
  userDataPath: string
  claims: SshTargetMadangdClaims
  targetId: string
  signal?: AbortSignal
}): Promise<void> {
  const cutover = findMadangdMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Staged/committed destinations require their own evidence before release.
  if (cutover?.phase !== 'source-fenced') {
    return
  }
  const environmentId = cutover.destinationEnvironmentId
  await closeMadangdManagedTunnel(environmentId).catch(() => undefined)
  await stopStrandedMadangd(args.targetId, args.signal).catch((error: unknown) => {
    console.warn(`[madangd] Could not stop the unreachable setup's server: ${errorMessage(error)}`)
  })
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  // Unregister first so an interrupted release leaves a recoverable undeployed fence.
  if (isRegistered(environmentId)) {
    removeManagedMadangdEnvironment(args.userDataPath, environmentId)
  }
  await releaseUndeployedMigrationFence({
    userDataPath: args.userDataPath,
    claims: args.claims,
    targetId: args.targetId,
    isDestinationRegistered: isRegistered,
    signal: args.signal
  })
}

/** Clear active only after proven slot exit; daemon terminals may outlive it. */
async function stopStrandedMadangd(targetId: string, signal?: AbortSignal): Promise<void> {
  const target = getSshTargetRegistryStore()?.getTarget(targetId)
  const connectionManager = getSshConnectionManager()
  if (!target || !connectionManager) {
    return
  }
  const context = await resolveMadangdRemoteContext(
    target,
    sshMadangdHostTransport(await connectionManager.connect(target)),
    signal
  )
  if (!context.activationRecord.active) {
    return
  }
  // Port is irrelevant because this recovery never launches a slot.
  const slot = managedMadangdSlot(context, 0, signal)
  await withMadangdActivationLock(
    slot,
    async () => {
      const record = await readMadangdActivationRecord(slot)
      if (!record.active) {
        return
      }
      const stopped = await stopMadangdSlot(slot, madangdSlotDir(slot, record.active), false)
      if (madangdStopFreedTheHost(stopped)) {
        await writeMadangdActivationRecord(slot, withDeactivatedVersionCommitted(record))
      }
    },
    () => undefined
  )
}
