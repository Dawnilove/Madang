import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/madang-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  discoverActivePtyId,
  execInTerminal,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { nodeTerminalCommand } from './terminal-node-command'

// Madang 기본값으로 실행한다 (다른 e2e는 Orca 기본값). 시험용 프로젝트는 기본으로 준비된다.
test.use({ orcaAppExtraEnv: { MADANG_E2E_ORCA_DEFAULTS: '0' } })

// 서랍 그룹이 맨 아래 자식인 세로 분할의 비율. 0.96 이상이면 접힌 상태 (terminal-drawer.ts).
async function readDrawerRatio(page: Page, groupId: string): Promise<number | null> {
  return page.evaluate((id) => {
    const state = window.__store!.getState()
    const wid = state.activeWorktreeId
    type Node = NonNullable<(typeof state.layoutByWorktree)[string]>
    const find = (node: Node): number | null => {
      if (node.type === 'leaf') {
        return null
      }
      if (
        node.direction === 'vertical' &&
        node.second.type === 'leaf' &&
        node.second.groupId === id
      ) {
        return node.ratio ?? 0.5
      }
      return find(node.first) ?? find(node.second)
    }
    const layout = wid ? state.layoutByWorktree[wid] : null
    return layout ? find(layout) : null
  }, groupId)
}

test('터미널 서랍: 열기, 명령 실행, 접기, 다시 열면 같은 터미널', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  const activeGroupId = (): Promise<string> =>
    orcaPage.evaluate(
      (wid) => window.__store!.getState().activeGroupIdByWorktree[wid] ?? '',
      worktreeId
    )
  const activeTabId = (): Promise<string | null> =>
    orcaPage.evaluate(
      (wid) => window.__store!.getState().activeTabIdByWorktree[wid] ?? null,
      worktreeId
    )
  const tabCount = (): Promise<number> =>
    orcaPage.evaluate(
      (wid) => window.__store!.getState().tabsByWorktree[wid]?.length ?? 0,
      worktreeId
    )

  await expect.poll(activeGroupId).not.toBe('')
  const initialGroupId = await activeGroupId()
  const tabsBefore = await tabCount()

  // 1) 상태 표시줄 버튼으로 연다.
  // 확인 필요: 상태 표시줄이 Madang 쉘에서 보이는지, 버튼 이름의 백틱 표기.
  const toggle = orcaPage.getByRole('button', { name: '터미널 서랍 (Ctrl+`)' })
  await toggle.click()

  await expect.poll(activeGroupId).not.toBe(initialGroupId)
  const drawerGroupId = await activeGroupId()
  await expect.poll(() => readDrawerRatio(orcaPage, drawerGroupId)).toBeLessThan(0.9)
  expect(await tabCount()).toBe(tabsBefore + 1)
  const drawerTabId = await activeTabId()

  // 2) 서랍 터미널에서 명령을 실행한다. 입력 줄에는 붙은 글자가 없도록 문자열을 나눈다.
  await waitForActiveTerminalManager(orcaPage)
  const ptyId = await discoverActivePtyId(orcaPage)
  await execInTerminal(
    orcaPage,
    ptyId,
    // 큰따옴표가 없는 한 줄: PowerShell은 인자의 큰따옴표를 지운다.
    nodeTerminalCommand([
      '-e',
      'console.log(Buffer.from([109,97,100,97,110,103,45,100,114,97,119,101,114,45,111,107]).toString())'
    ])
  )
  await waitForTerminalOutput(orcaPage, 'madang-drawer-ok', 20_000)

  // 3) 단축키로 접는다.
  // 확인 필요: 터미널에 포커스가 있을 때 Control+Backquote 가 캡처 단계에서 잡히는지.
  await orcaPage.keyboard.press('Control+Backquote')
  await expect.poll(() => readDrawerRatio(orcaPage, drawerGroupId)).toBeGreaterThanOrEqual(0.95)

  // 4) 다시 열면 같은 터미널이 남아 있다 (새 탭이 생기지 않고 출력이 그대로).
  await toggle.click()
  await expect.poll(() => readDrawerRatio(orcaPage, drawerGroupId)).toBeLessThan(0.9)
  expect(await tabCount()).toBe(tabsBefore + 1)
  expect(await activeTabId()).toBe(drawerTabId)
  await waitForTerminalOutput(orcaPage, 'madang-drawer-ok', 20_000)
})
