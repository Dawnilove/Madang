import { ipcMain } from 'electron'
import type { MadangdManagedRuntimeStatus } from '../../../shared/madangd-managed-runtime'
import { createManagedMadangdEnvironment } from '../../managed-server/lifecycle/madangd-runtime-deployment'
import { getManagedMadangdRuntimeStatus } from '../../managed-server/lifecycle/madangd-runtime-status'

export function registerMadangdRuntimeLifecycleHandlers(options: {
  getUserDataPath: () => string
}): void {
  ipcMain.handle(
    'runtimeEnvironments:deployMadangd',
    async (_event, args: { name: string; sshTargetId: string; force?: boolean }) =>
      createManagedMadangdEnvironment(options.getUserDataPath(), {
        name: requiredString(args?.name, 'Server name'),
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        force: args?.force === true
      })
  )
  ipcMain.handle(
    'runtimeEnvironments:getMadangdStatus',
    (_event, args: { selector: string }): Promise<MadangdManagedRuntimeStatus> =>
      getManagedMadangdRuntimeStatus(
        options.getUserDataPath(),
        requiredString(args?.selector, 'Server')
      )
  )
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}
