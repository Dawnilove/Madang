import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { selectFolderWorkspaces, selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import type { AiVaultSession, ClaudeDesktopActiveSession } from '../../../../shared/ai-vault-types'
import {
  desktopSyncGroupLabel,
  desktopSyncTarget,
  forwardSlashes,
  planDesktopSync,
  type DesktopSyncPlan
} from './ai-vault-desktop-sync-plan'
import { takeNewDesktopActivity } from './desktop-new-activity'
import { liveChatTabsFor, nameNewChatTab, syncOpenChatNames } from './desktop-session-chat-names'
import { AiVaultDesktopSyncDialog } from './AiVaultDesktopSyncDialog'
import type { ClaudeDesktopIdSets } from './use-claude-desktop-session-ids'
import type { AiVaultResumeInChatEligibility } from './ai-vault-session-resume-in-chat'

const RECENT_OPEN_MS = 30_000

// shortcut: gives up after ~10s and launches anyway, so a slow host shows its own refusal.
async function waitUntilHostResolves(worktree: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const reply = (await window.api.runtime.call({
        method: 'agentSession.createSupport',
        params: { worktree, agent: 'claude' }
      })) as { ok?: boolean }
      if (reply.ok) {
        return
      }
    } catch {
      // 아직 못 찾은 것이다. 다시 묻는다.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

function chatTabIds(worktreeId: string): Set<string> {
  return new Set(
    (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? [])
      .filter((tab) => tab.contentType === 'agent-session')
      .map((tab) => tab.id)
  )
}

// 프로젝트가 아닌 폴더(예: Claude Code 워크트리)는 원래 프로젝트의 그룹 안에 폴더 작업 1줄로 만든다.
async function folderWorkspaceFor(folderPath: string, originCwd: string): Promise<string | null> {
  const origin = forwardSlashes(originCwd)
  const store = useAppStore.getState()
  let groupId =
    store.projectGroups.find(
      (group) => group.parentPath !== null && forwardSlashes(group.parentPath) === origin
    )?.id ?? null
  if (!groupId) {
    groupId =
      (
        await window.api.projectGroups.create({
          name: desktopSyncGroupLabel(origin),
          parentPath: origin,
          createdFrom: 'manual'
        })
      ).id ?? null
    await useAppStore.getState().fetchProjectGroupsForAllHosts()
  }
  if (!groupId) {
    return null
  }
  // 프로젝트를 같은 그룹에 넣어야 사이드바에서 그 프로젝트 아래에 이 줄이 보인다.
  const repo = useAppStore.getState().repos.find((r) => forwardSlashes(r.path) === origin)
  if (repo && repo.projectGroupId !== groupId) {
    await useAppStore.getState().moveProjectToGroup(repo, groupId)
  }
  const workspace = await useAppStore.getState().createFolderWorkspace(
    {
      projectGroupId: groupId,
      name: folderPath.split('/').pop() || folderPath,
      folderPath,
      createdWithAgent: 'claude'
    },
    { runtimeEnvironmentId: null }
  )
  if (!workspace) {
    return null
  }
  const worktreeId = `folder:${workspace.id}`
  // 만든 직후에는 호스트가 아직 작업 공간을 못 찾아 채팅을 거부한다. 찾을 때까지 기다린다.
  await waitUntilHostResolves(worktreeId)
  return worktreeId
}

// 열린 Chat 탭은 처음 한 번만 대화를 복사해 두므로, 데스크톱에서 쌓인 대화를 호스트가 다시 읽게 한다. 응답 중인 탭은 건너뛴다.
async function refreshOpenChats(
  active: readonly ClaudeDesktopActiveSession[],
  sessions: readonly AiVaultSession[]
): Promise<{ refreshed: number; busy: number }> {
  let refreshed = 0
  let busy = 0
  for (const entry of active) {
    if (liveChatTabsFor(entry.sessionId, sessions).length === 0) {
      continue
    }
    const result = await window.api.aiVault
      .refreshDesktopChat({ sessionId: entry.sessionId })
      .catch(() => 'unreadable' as const)
    refreshed += result === 'refreshed' ? 1 : 0
    busy += result === 'busy' ? 1 : 0
  }
  return { refreshed, busy }
}

/**
 * Opens the Claude desktop app's active sessions as tabs in Madang, the user picking them first: each in
 * its project's row, so the sidebar keeps one row per project and its sessions line up as tabs. A session
 * whose folder is no project (a Claude Code worktree) gets one row per folder. Adds only; nothing is removed.
 */
export function useSyncDesktopActiveSessions(args: {
  desktopIds: ClaudeDesktopIdSets | undefined
  sessions: readonly AiVaultSession[]
  openAsChat: boolean
  getSessionResumeInChat: (session: AiVaultSession) => AiVaultResumeInChatEligibility
  paneActions: {
    getOriginalPaneTarget: (session: AiVaultSession) => unknown
  }
  handleResume: (session: AiVaultSession, worktreeId: string) => void
  handleResumeInNewChat: (session: AiVaultSession, worktreeId: string) => void
}): { start: () => void; dialog: React.JSX.Element | null } {
  const { desktopIds, sessions, openAsChat, getSessionResumeInChat, paneActions } = args
  const { handleResume, handleResumeInNewChat } = args
  const [pending, setPending] = useState<DesktopSyncPlan | null>(null)
  // A tab opened here is not found by the pane lookup until its agent reports in; remember it briefly.
  // shortcut: a tab closed within the window still reads as open; it can be reopened after it.
  const openedHere = useRef(new Map<string, number>())
  const seenActivity = useRef(new Map<string, number>())

  // 창이 다시 포커스되어 목록이 새로 읽힐 때, 열린 Chat에 데스크톱의 새 대화가 있으면 알리기만 한다. 다시 읽기는 버튼으로 한다.
  useEffect(() => {
    if (!desktopIds) {
      return
    }
    const changed = takeNewDesktopActivity(
      desktopIds.active,
      seenActivity.current,
      (sessionId) => liveChatTabsFor(sessionId, sessions).length > 0
    )
    if (changed.length > 0) {
      toast(
        translate(
          'madang.aiVault.openDesktopActive.newActivity',
          '{{count}} open chats have newer conversation in the desktop app. Use "Open active Claude desktop sessions" to re-read.',
          { count: changed.length }
        )
      )
    }
  }, [desktopIds, sessions])

  const findSession = useCallback(
    (sessionId: string) =>
      sessions.find(
        (candidate) => candidate.agent === 'claude' && candidate.sessionId === sessionId
      ),
    [sessions]
  )

  const run = useCallback(
    async (plan: DesktopSyncPlan, selected: ReadonlySet<string>): Promise<void> => {
      const made = new Map<string, string | null>()
      let opened = 0
      let skipped = 0
      for (const item of plan.items.filter((entry) => selected.has(entry.session.sessionId))) {
        const session = findSession(item.session.sessionId)
        if (!session) {
          console.warn('[desktop-sync] session not in the session list', item.session.sessionId)
          skipped += 1
          continue
        }
        try {
          const state = useAppStore.getState()
          const target = desktopSyncTarget({
            cwd: item.session.cwd,
            worktrees: Object.values(selectWorktreesByRepo(state)).flat(),
            folders: selectFolderWorkspaces(state)
          })
          let worktreeId = 'worktreeId' in target ? target.worktreeId : null
          // 새로 만든 줄은 아직 채팅 가능 여부를 계산하지 못했다. main이 폴더를 확인하므로 채팅으로 연다.
          const madeNow = !worktreeId
          if (!worktreeId && 'folderPath' in target) {
            if (!made.has(target.folderPath)) {
              made.set(
                target.folderPath,
                await folderWorkspaceFor(target.folderPath, item.session.originCwd)
              )
            }
            worktreeId = made.get(target.folderPath) ?? null
          }
          if (!worktreeId) {
            console.warn('[desktop-sync] no row to open the session in', item.session.cwd)
            skipped += 1
            continue
          }
          openedHere.current.set(session.sessionId, Date.now())
          opened += 1
          // 채팅은 대화 폴더와 작업 폴더가 같아야 열린다. 안 되면 터미널로 이어한다.
          if (openAsChat && (madeNow || getSessionResumeInChat(session).available)) {
            const before = chatTabIds(worktreeId)
            handleResumeInNewChat(session, worktreeId)
            // 한 개씩 기다린다. 동시에 열면 어느 탭이 어느 세션인지 알 수 없다.
            await nameNewChatTab(worktreeId, before, item.session.title)
          } else {
            handleResume(session, worktreeId)
          }
        } catch (error) {
          skipped += 1
          toast.error(error instanceof Error ? error.message : String(error))
        }
      }
      toast(
        translate(
          'madang.aiVault.openDesktopActive.result',
          '{{opened}} opened · {{alreadyOpen}} already open · {{skipped}} outside open projects',
          { opened, alreadyOpen: plan.existing, skipped }
        )
      )
    },
    [findSession, getSessionResumeInChat, handleResume, handleResumeInNewChat, openAsChat]
  )

  const start = useCallback(() => {
    if (!desktopIds) {
      toast.error(
        translate(
          'madang.aiVault.openDesktopActive.unavailable',
          'Could not read the Claude desktop app sessions.'
        )
      )
      return
    }
    void (async () => {
      // 프로젝트 폴더가 Madang에 없으면 먼저 추가한다. 그래야 세션이 그 프로젝트 줄의 탭으로 열린다.
      const knownProjects = new Set(
        useAppStore.getState().repos.map((repo) => forwardSlashes(repo.path))
      )
      for (const origin of new Set(
        desktopIds.active.map((session) => forwardSlashes(session.originCwd))
      )) {
        if (knownProjects.has(origin) || /\/scratch-workspaces\//.test(origin)) {
          continue
        }
        try {
          // Git이 아닌 폴더를 git으로 추가하면 확인 창이 떠서 멈춘다. 먼저 git인지 물어보고 종류를 정해서 추가한다.
          // git 폴더면 이 확인 호출이 이미 추가한 것이다. 다시 추가하면 "이미 추가됨" 알림이 뜬다.
          const probe = await window.api.repos.add({ path: origin, kind: 'git' })
          if (!('error' in probe)) {
            continue
          }
          if (!probe.error.includes('Not a valid git repository')) {
            throw new Error(probe.error)
          }
          await useAppStore.getState().addRepoPath(origin, 'folder')
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error))
        }
      }
      await syncOpenChatNames(desktopIds.active, sessions)
      const reread = await refreshOpenChats(desktopIds.active, sessions)
      if (reread.refreshed + reread.busy > 0) {
        toast(
          translate(
            'madang.aiVault.openDesktopActive.refreshed',
            '{{refreshed}} open chats re-read with the latest conversation · {{busy}} skipped because they are responding',
            reread
          )
        )
      }
      const plan = planDesktopSync({
        active: desktopIds.active,
        isOpen: (sessionId) => {
          const session = findSession(sessionId)
          return (
            Date.now() - (openedHere.current.get(sessionId) ?? 0) < RECENT_OPEN_MS ||
            liveChatTabsFor(sessionId, sessions).length > 0 ||
            (session !== undefined && Boolean(paneActions.getOriginalPaneTarget(session)))
          )
        }
      })
      if (plan.items.length === 0) {
        toast(
          translate('madang.aiVault.syncDesktop.nothing', '{{count}} sessions already open', {
            count: plan.existing
          })
        )
        return
      }
      setPending(plan)
    })()
  }, [desktopIds, findSession, paneActions, sessions])

  const dialog = pending
    ? createElement(AiVaultDesktopSyncDialog, {
        plan: pending,
        onCancel: () => setPending(null),
        onConfirm: (selected: ReadonlySet<string>) => {
          setPending(null)
          void run(pending, selected)
        }
      })
    : null
  return { start, dialog }
}
