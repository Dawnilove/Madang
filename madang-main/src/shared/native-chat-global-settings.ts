import type { AgentChatPermissionMode } from './agent-chat-permission-mode'
import type { PersistedNativeChatSessionOptions } from './native-chat-session-options'

export type NativeChatGlobalSettings = {
  /** New supported agent launches use structured Chat UI; off defaults to terminal UI. */
  experimentalNativeChat?: boolean
  /** The "open active sessions" button opens Chat tabs; absent follows experimentalNativeChat. */
  openDesktopActiveInChat?: boolean
  /** Opt-in resume of working structured chats after restart; off still lists them for review before token spending. */
  nativeChatResumeWorkOnRestart?: boolean
  /** Queue editable mid-turn follow-ups until turn end on capable hosts. Absent means on; off sends immediately. */
  nativeChatQueueFollowUps?: boolean
  /** Teach newly started native chats to create inline visuals; absent means on. */
  nativeChatInlineVisuals?: boolean
  /** Structured Codex/Claude chats inherit the login-shell env; off limits it to nativeChatShellEnvironmentVariables plus PATH/locale. */
  nativeChatInheritShellEnvironment?: boolean
  /** Login-shell variable names structured chat inherits while the whole environment is off. */
  nativeChatShellEnvironmentVariables?: string[]
  /** Last explicit native-chat model + option selections; live panes need an applied/dispatched record before showing a value. */
  nativeChatSessionOptions?: PersistedNativeChatSessionOptions
  /** Legacy client permission control and host-support marker; kept valid for old peers. */
  nativeChatPermissionMode?: AgentChatPermissionMode
}
