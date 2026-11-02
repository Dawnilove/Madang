import { useCallback, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { selectFolderWorkspaces, selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import type { RunChatCommandResult } from '../../../../shared/ai-vault-types'

/** `!npm test` on a single line: the command, or null for any other draft. */
export function parseNativeChatBangDraft(draft: string): string | null {
  const match = /^!\s*([^\n\r]+)$/.exec(draft.trim())
  const command = match?.[1]?.trim()
  return command ? command : null
}

/** The command and its output as one fenced block, ready to be sent with a question below it. */
export function formatNativeChatBangResult(command: string, result: RunChatCommandResult): string {
  const notes = [
    result.timedOut
      ? translate('components.native-chat.bang.timedOut', 'stopped after 60 seconds')
      : null,
    result.truncated
      ? translate('components.native-chat.bang.truncated', 'only the last part is shown')
      : null,
    result.exitCode !== null && result.exitCode !== 0
      ? translate('components.native-chat.bang.exitCode', 'exit code {{code}}', {
          code: result.exitCode
        })
      : null
  ].filter((note): note is string => note !== null)
  const body = result.output.replace(/\s+$/, '')
  // A longer fence than any run of backticks in the output keeps the block closed.
  const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n$ ${command}\n${body}\n${fence}${notes.length ? `\n(${notes.join(', ')})` : ''}\n\n`
}

function workspacePathFor(worktreeId: string): string | null {
  const state = useAppStore.getState()
  const worktree = Object.values(selectWorktreesByRepo(state))
    .flat()
    .find((entry) => entry.id === worktreeId)
  if (worktree) {
    return worktree.path
  }
  const folder = selectFolderWorkspaces(state).find((entry) => `folder:${entry.id}` === worktreeId)
  return folder?.folderPath ?? null
}

/**
 * `!command` in the chat input runs the command in the chat's workspace folder and puts the command with its
 * output into the input (not sent), so the user can add a question and send it as context.
 */
export function useNativeChatBangCommand(args: {
  worktreeId: string | undefined
  setDraft: (value: string) => void
  setCaret: (caret: number) => void
  setNotice: (notice: string | null) => void
}): { consume: (draft: string) => boolean } {
  const { worktreeId, setCaret, setDraft, setNotice } = args
  const running = useRef(false)
  const consume = useCallback(
    (draft: string): boolean => {
      const command = parseNativeChatBangDraft(draft)
      if (!command || !worktreeId) {
        return false
      }
      const cwd = workspacePathFor(worktreeId)
      if (!cwd) {
        return false
      }
      if (running.current) {
        return true
      }
      running.current = true
      setNotice(
        translate('components.native-chat.bang.running', 'Running… {{command}}', { command })
      )
      void window.api.aiVault
        .runChatCommand({ cwd, command })
        .then((result) => {
          if (result.error) {
            setNotice(
              translate(
                'components.native-chat.bang.failed',
                'Could not run the command: {{error}}',
                {
                  error: result.error
                }
              )
            )
            return
          }
          const text = formatNativeChatBangResult(command, result)
          setDraft(text)
          setCaret(text.length)
          setNotice(null)
        })
        .catch((error: unknown) =>
          setNotice(error instanceof Error ? error.message : String(error))
        )
        .finally(() => {
          running.current = false
        })
      return true
    },
    [setCaret, setDraft, setNotice, worktreeId]
  )
  return { consume }
}
