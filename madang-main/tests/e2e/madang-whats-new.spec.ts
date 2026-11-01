import { test, expect } from './helpers/madang-app'
import { waitForSessionReady } from './helpers/store'

// Madang 기본값으로 실행한다 (다른 e2e는 Orca 기본값).
test.use({ orcaAppExtraEnv: { MADANG_E2E_ORCA_DEFAULTS: '0' }, seedTestRepo: false })

const FAKE_NOTES = {
  title: '가짜 릴리스',
  body: '- madang-e2e-notes-ok',
  url: 'https://example.invalid/release'
}

test('새로운 점 창: 버전이 다르면 뜨고, 닫으면 현재 버전을 기록해 다시 안 뜬다', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  const version = await orcaPage.evaluate(() => window.api.updater.getVersion())
  const lastSeen = (): Promise<string | undefined> =>
    orcaPage.evaluate(() => window.__store!.getState().settings?.lastSeenWhatsNewVersion)

  // 새 프로필은 첫 실행이라 창 없이 현재 버전만 기록된다.
  await expect.poll(lastSeen).toBe(version)

  // 개발 모드는 릴리스 본문을 가져오지 않는다. 메인의 IPC 응답을 가짜 본문으로 바꾼다 (외부 접속 없음).
  await electronApp.evaluate(({ ipcMain }, notes) => {
    ipcMain.removeHandler('updater:getReleaseNotes')
    ipcMain.handle('updater:getReleaseNotes', () => notes)
  }, FAKE_NOTES)

  // 옛 버전을 본 것으로 기록한 뒤 다시 불러오면 시작 확인이 다시 돈다.
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({ lastSeenWhatsNewVersion: '0.0.1' })
  )
  await orcaPage.reload()
  await orcaPage.waitForFunction(() => window.__store?.getState().settings != null)

  const dialog = orcaPage.getByRole('dialog', { name: '새로운 점' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText(`버전 ${version}`)).toBeVisible()
  await expect(dialog.getByText('madang-e2e-notes-ok')).toBeVisible()

  await dialog.getByRole('button', { name: '닫기' }).first().click()
  await expect(dialog).toBeHidden()
  await expect.poll(lastSeen).toBe(version)

  // 다시 불러와도 (설정은 메인에서 다시 읽는다) 창이 뜨지 않는다.
  await orcaPage.reload()
  await orcaPage.waitForFunction(
    (v) => window.__store?.getState().settings?.lastSeenWhatsNewVersion === v,
    version
  )
  // 확인 필요: 부정 검사라 시작 확인이 끝나기 전에 통과할 수 있다. 끝난 신호가 필요하면 고친다.
  await expect(orcaPage.getByRole('dialog', { name: '새로운 점' })).toHaveCount(0)
})
