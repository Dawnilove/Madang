import { desktopChatCreationHistory } from '../runtime/desktop-chat-creation-history'
import type { EphemeralVmRuntimeRecord } from '../../shared/ephemeral-vm-runtimes'
import { removeManagedMadangdEnvironment } from '../../shared/runtime-environment-managed-madangd-store'
import { listEnvironments, removeEnvironment } from '../../shared/runtime-environment-store'
import { getMadangdSshDeployment } from '../../shared/runtime-environments'

/** Remove destroyed VM servers so managed tunnels stop reconnecting. */
export async function releaseEphemeralVmRuntimeEnvironments(
  userDataPath: string,
  runtime: Pick<EphemeralVmRuntimeRecord, 'runtimeEnvironmentId' | 'sshTargetId'>
): Promise<void> {
  // Relay-era conversions may have recorded only the SSH target, not the server ID.
  const environments = listEnvironments(userDataPath).filter(
    (entry) =>
      entry.id === runtime.runtimeEnvironmentId ||
      (runtime.sshTargetId !== undefined &&
        getMadangdSshDeployment(entry)?.sshTargetId === runtime.sshTargetId)
  )
  for (const environment of environments) {
    if (!environment.madangdDeployment) {
      removeEnvironment(userDataPath, environment.id)
      void desktopChatCreationHistory(userDataPath).removeEnvironment(environment.id)
      continue
    }
    const { closeMadangdManagedTunnel } =
      await import('../managed-server/lifecycle/madangd-managed-tunnel')
    await closeMadangdManagedTunnel(environment.id).catch(() => undefined)
    removeManagedMadangdEnvironment(userDataPath, environment.id)
    void desktopChatCreationHistory(userDataPath).removeEnvironment(environment.id)
  }
}
