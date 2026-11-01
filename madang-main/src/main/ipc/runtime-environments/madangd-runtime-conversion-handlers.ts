import { ipcMain } from 'electron'
import type {
  MadangdManagedConversionResult,
  MadangdManagedPendingMigrationRow
} from '../../../shared/madangd-managed-runtime'
import { listPendingManagedMadangdMigrations } from '../../managed-server/lifecycle/madangd-managed-migration-status'
import { convertSshTargetToManagedMadangd } from '../../managed-server/lifecycle/madangd-runtime-conversion'
import { conversionCollaborators } from '../../managed-server/lifecycle/madangd-runtime-conversion-wiring'
import { requiredString } from './madangd-runtime-lifecycle-handlers'

export function registerMadangdRuntimeConversionHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:convertSshHostToManagedMadangd',
    (
      _event,
      args: { sshTargetId: string; name: string }
    ): Promise<MadangdManagedConversionResult> => {
      return convertSshTargetToManagedMadangd(getUserDataPath(), {
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        name: requiredString(args?.name, 'Server name'),
        ...conversionCollaborators()
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:listPendingMadangdMigrations',
    (): MadangdManagedPendingMigrationRow[] => listPendingManagedMadangdMigrations(getUserDataPath())
  )
}
