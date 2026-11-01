/** IPC for "Move anyway": the user confirms that saved state a move can't carry stays on this desktop. */
import { ipcMain } from 'electron'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { requiredString } from './madangd-runtime-lifecycle-handlers'

export function registerMadangdLeaveBehindHandlers(): void {
  ipcMain.handle(
    'runtimeEnvironments:allowMadangdMoveLeavingBehind',
    (_event, args: { sshTargetId: string }): void => {
      const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
      const registry = getSshTargetRegistryStore()
      if (!registry?.getTarget(sshTargetId)) {
        throw new Error('The SSH host is gone.')
      }
      // Read by the export on the next connect; cleared once the host moves.
      registry.updateTarget(sshTargetId, {
        managedServerLeaveBehind: { confirmedAt: new Date().toISOString() }
      })
    }
  )
}
