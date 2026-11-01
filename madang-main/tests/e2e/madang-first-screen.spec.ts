import { test, expect } from './helpers/madang-app'
import { waitForSessionReady } from './helpers/store'

// Runs the app with Madang defaults (the rest of the suite runs with Orca defaults).
test.use({ orcaAppExtraEnv: { MADANG_E2E_ORCA_DEFAULTS: '0' }, seedTestRepo: false })

test('Madang shell opens in Korean and asks for a first project', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await expect(orcaPage.getByRole('heading', { name: 'MADANG' })).toBeVisible({ timeout: 30_000 })
  await expect(orcaPage.getByText('시작하려면 프로젝트를 추가하세요.')).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: '프로젝트 추가' }).first()).toBeVisible()
})
