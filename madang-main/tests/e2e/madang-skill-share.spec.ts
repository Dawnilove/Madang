import { test, expect } from './helpers/madang-app'
import { waitForSessionReady } from './helpers/store'

// Madang 기본값으로 실행한다 (다른 e2e는 Orca 기본값).
test.use({ orcaAppExtraEnv: { MADANG_E2E_ORCA_DEFAULTS: '0' }, seedTestRepo: false })

const ORCA_LINK = 'https://share.onorca.dev/skills/share/madang-e2e-link'

test('스킬 공유 메뉴: 항목 4개, GitHub 오류 문구, Orca 링크 확인창과 취소', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)

  // 실제 서버 접속을 막는다: 메인 프로세스의 가져오기 핸들러를 호출 횟수만 세는 가짜로 바꾼다.
  await electronApp.evaluate(({ ipcMain }) => {
    const g = globalThis as { __madangOrcaShareCalls?: number }
    g.__madangOrcaShareCalls = 0
    ipcMain.removeHandler('skills:importCompatShare')
    ipcMain.handle('skills:importCompatShare', () => {
      g.__madangOrcaShareCalls = (g.__madangOrcaShareCalls ?? 0) + 1
      return { status: 'error', code: 'network' }
    })
  })
  const orcaCalls = (): Promise<number> =>
    electronApp.evaluate(
      () => (globalThis as { __madangOrcaShareCalls?: number }).__madangOrcaShareCalls ?? 0
    )
  // 화면(렌더러)에서 나가는 요청도 센다.
  const rendererOrcaRequests: string[] = []
  orcaPage.on('request', (request) => {
    if (request.url().includes('onorca.dev')) {
      rendererOrcaRequests.push(request.url())
    }
  })

  // 확인 필요: 스킬 화면을 사이드바 버튼 대신 스토어로 연다 (Madang 쉘에 스킬 버튼이 없을 수 있음).
  await orcaPage.evaluate(() => window.__store!.getState().openSkillsPage())

  const openMenu = async (): Promise<void> => {
    await orcaPage.getByRole('button', { name: '스킬 공유', exact: true }).click()
  }

  // 1) 메뉴 항목 4개
  await openMenu()
  await expect(orcaPage.getByRole('menuitem')).toHaveCount(4)
  await expect(orcaPage.getByRole('menuitem', { name: '스킬 내보내기…' })).toBeVisible()
  await expect(orcaPage.getByRole('menuitem', { name: '파일에서 가져오기…' })).toBeVisible()
  await expect(orcaPage.getByRole('menuitem', { name: 'GitHub 주소로 설치…' })).toBeVisible()
  await expect(orcaPage.getByRole('menuitem', { name: 'Orca 공유 링크로 가져오기…' })).toBeVisible()

  // 2) 잘못된 GitHub 주소 -> 한국어 오류
  await orcaPage.getByRole('menuitem', { name: 'GitHub 주소로 설치…' }).click()
  const githubDialog = orcaPage.getByRole('dialog', { name: 'GitHub 주소로 스킬 설치' })
  await githubDialog.getByLabel('GitHub 주소').fill('not-a-url')
  await githubDialog.getByRole('button', { name: '스킬 찾기' }).click()
  await expect(githubDialog.getByRole('alert')).toContainText(
    'https://github.com/소유자/저장소 형식의 주소를 입력하세요.'
  )
  await githubDialog.getByRole('button', { name: '취소' }).click()
  await expect(githubDialog).toBeHidden()

  // 3) Orca 링크 -> 확인창 -> 취소하면 요청 0건
  await openMenu()
  await orcaPage.getByRole('menuitem', { name: 'Orca 공유 링크로 가져오기…' }).click()
  const orcaDialog = orcaPage.getByRole('dialog', { name: 'Orca 공유 링크로 스킬 가져오기' })
  await orcaDialog.getByLabel('Orca 스킬 공유 링크').fill(ORCA_LINK)
  await orcaDialog.getByRole('button', { name: '다음' }).click()
  await expect(
    orcaDialog.getByText('Orca용으로 만든 제3자 스킬입니다. Madang이 검증하지 않았습니다.')
  ).toBeVisible()
  await orcaDialog.getByRole('button', { name: '취소' }).click()
  await expect(orcaDialog).toBeHidden()
  expect(await orcaCalls()).toBe(0)
  expect(rendererOrcaRequests).toEqual([])

  // 4) 대조군: "계속"을 누르면 가져오기 호출이 정확히 1번 나간다 (가짜 핸들러가 오류를 돌려줌).
  await openMenu()
  await orcaPage.getByRole('menuitem', { name: 'Orca 공유 링크로 가져오기…' }).click()
  await orcaDialog.getByLabel('Orca 스킬 공유 링크').fill(ORCA_LINK)
  await orcaDialog.getByRole('button', { name: '다음' }).click()
  await orcaDialog.getByRole('button', { name: '계속' }).click()
  await expect(orcaDialog.getByRole('alert')).toContainText('내려받지 못했습니다.')
  expect(await orcaCalls()).toBe(1)
})
