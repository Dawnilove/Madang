import type { TuiAgent } from '../../../../../shared/tui-agent'

const DISPLAY_NAME_CHARS = 40

/** Folder-safe unique name; the typed text goes to the display name and the first message instead. */
export function buildConversationName(now: Date, suffix: string): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `madang-${date}-${time}-${suffix}`
}

export function buildConversationDisplayName(text: string): string {
  const flat = text.trim().replace(/\s+/g, ' ')
  return flat.length > DISPLAY_NAME_CHARS ? `${flat.slice(0, DISPLAY_NAME_CHARS)}…` : flat
}

/** Everything that touches the app lives behind these, so the order of steps is testable alone. */
export type FirstConversationDeps = {
  createWorktree(repoId: string, name: string, displayName: string): Promise<{ id: string } | null>
  activateWorktree(worktreeId: string): void
  launchAgent(args: { worktreeId: string; agent: TuiAgent; prompt: string }): void
  now(): Date
  newSuffix(): string
}

export type FirstConversationResult =
  | { ok: true; worktreeId: string }
  | { ok: false; reason: 'empty' | 'create-failed'; message?: string }

/** One typed request becomes a new workspace and an agent that already has the request as its first message. */
export async function startFirstConversation(
  input: { repoId: string; agent: TuiAgent; text: string },
  deps: FirstConversationDeps
): Promise<FirstConversationResult> {
  const text = input.text.trim()
  if (!text) {
    return { ok: false, reason: 'empty' }
  }
  let created: { id: string } | null
  try {
    created = await deps.createWorktree(
      input.repoId,
      buildConversationName(deps.now(), deps.newSuffix()),
      buildConversationDisplayName(text)
    )
  } catch (error) {
    return {
      ok: false,
      reason: 'create-failed',
      message: error instanceof Error ? error.message : String(error)
    }
  }
  if (!created) {
    return { ok: false, reason: 'create-failed' }
  }
  deps.activateWorktree(created.id)
  deps.launchAgent({ worktreeId: created.id, agent: input.agent, prompt: text })
  return { ok: true, worktreeId: created.id }
}
