import { test, expect } from './helpers/madang-app'
import { waitForSessionReady } from './helpers/store'

// Madang 기본값으로 실행한다 (다른 e2e는 Orca 기본값).
test.use({ orcaAppExtraEnv: { MADANG_E2E_ORCA_DEFAULTS: '0' }, seedTestRepo: false })

test('도움말 메뉴에서 오픈소스 라이선스를 열고 닫는다', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)

  // 확인 필요: 프로젝트가 없는 첫 화면에서도 사이드바 하단 도움말 버튼이 보이는지.
  await orcaPage.getByRole('button', { name: '도움말', exact: true }).click()
  await orcaPage.getByRole('menuitem', { name: '오픈소스 라이선스' }).click()

  const dialog = orcaPage.getByRole('dialog', { name: '오픈소스 라이선스' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByText('Madang은 오픈소스 Orca(MIT)를 기반으로 만들었습니다.')
  ).toBeVisible()
  // LICENSE 파일 원문. 저작권 고지는 "Lovecast Inc." 이다 (Stably AI 아님).
  const text = dialog.getByTestId('license-text')
  await expect(text).toContainText('MIT License')
  await expect(text).toContainText('Copyright (c) 2026 Lovecast Inc.')

  await orcaPage.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
