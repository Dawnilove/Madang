import { createE2EConfig, type E2EConfig } from '../shared/e2e-config'
import { isOrcaDefaultsRequested } from '../shared/madang-features'

export function getMainE2EConfig(): E2EConfig {
  return createE2EConfig({
    headless: process.env.MADANG_E2E_HEADLESS === '1',
    userDataDir: process.env.MADANG_E2E_USER_DATA_DIR ?? null,
    orcaDefaults: isOrcaDefaultsRequested()
  })
}
