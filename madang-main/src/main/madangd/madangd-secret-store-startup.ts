import { join } from 'node:path'
import { prepareMadangdSecretStore } from './madangd-host-adapters'

export async function prepareMadangdSecretStoreAndMigrate(userDataPath: string): Promise<void> {
  const { getSecretStore } = await import('../../shared/secret-store')
  const { reportSecretProtectionGap } = await import('../host/secret-protection-report')
  const { migratePlaintextCredentials, madangdCredentialRoot } =
    await import('./madangd-plaintext-credential-migration')
  // Keep sealing keys outside disposable MADANG_USER_DATA roots.
  if (await prepareMadangdSecretStore(madangdCredentialRoot(), userDataPath)) {
    migratePlaintextCredentials(getSecretStore())
  }
  reportSecretProtectionGap({ dataFile: join(userDataPath, 'orca-data.json') })
}
