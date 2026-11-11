import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { useCallback } from 'react'
import { createPortal } from 'react-dom'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { NativeChatSessionOptionPickers } from '../native-chat/NativeChatSessionOptionPickers'
import { useNativeChatSessionOptionCommand } from '../native-chat/use-native-chat-session-option-command'
import { useNativeChatSessionOptions } from '../native-chat/use-native-chat-session-options'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { TerminalPaneController } from './use-terminal-pane-controller'

/**
 * Model and effort pickers over a plain terminal that runs Claude. The terminal is the real Claude TUI, so a pick
 * types `/model` or `/effort` into it (after the terminal has gone quiet) exactly as the chat input already does.
 */
// Only agents whose model switch is confirmed in their docs (/model; Grok also /effort). Others get no bar.
const BAR_AGENTS: readonly AgentType[] = ['claude', 'codex', 'grok', 'gemini', 'cursor']

export function TerminalPaneSessionOptionsBar({
  controller
}: {
  controller: TerminalPaneController
}): React.JSX.Element | null {
  const { activeAgentId, activePane, effectiveChatViewMode, isActive } = controller
  if (
    effectiveChatViewMode ||
    !isActive ||
    !activeAgentId ||
    !BAR_AGENTS.includes(activeAgentId) ||
    !activePane?.container
  ) {
    return null
  }
  return createPortal(
    <SessionOptionsBarInner
      agent={activeAgentId}
      controller={controller}
      paneId={activePane.id}
      leafId={activePane.leafId}
    />,
    activePane.container
  )
}

function SessionOptionsBarInner({
  agent,
  controller,
  paneId,
  leafId
}: {
  agent: AgentType
  controller: TerminalPaneController
  paneId: number
  leafId: string
}): React.JSX.Element | null {
  const { managerRef, paneTransportsRef, tabId } = controller
  const ptyId = paneTransportsRef.current.get(paneId)?.getPtyId() ?? null
  const paneKey = makePaneKey(tabId, leafId)

  const resolveTarget = useCallback(() => {
    const live = paneTransportsRef.current.get(paneId)?.getPtyId() ?? null
    return live ? { ptyId: live } : null
  }, [paneId, paneTransportsRef])
  const readTerminalScreen = useCallback(
    (): string | null =>
      managerRef.current
        ?.getPanes()
        .find((pane) => pane.leafId === leafId)
        ?.serializeAddon.serialize({ scrollback: 0 }) ?? null,
    [leafId, managerRef]
  )
  const { dispatch, isDispatching } = useNativeChatSessionOptionCommand({
    agent,
    disabled: false,
    resolveTarget
  })
  const { surface, snapshot } = useNativeChatSessionOptions({
    agent,
    terminalTabId: tabId,
    targetPtyId: ptyId,
    dispatchCommand: dispatch,
    readTerminalScreen,
    paneKey
  })
  // shortcut: "working" here only covers our own option command; a Claude reply in flight is handled by the
  // dispatch waiting for the terminal to go quiet. Use the agent status once its pane key is verified here.
  // No model reported yet: render nothing, so no empty strip takes a terminal row.
  if (!surface || !snapshot.some((descriptor) => descriptor.category === 'model')) {
    return null
  }
  const summaryText = [
    currentChoiceLabel(snapshot, (descriptor) => descriptor.category === 'model'),
    currentChoiceLabel(snapshot, (descriptor) => descriptor.category === 'thought_level')
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
  return (
    <div className="pane-bottom-bar text-[13px] text-foreground">
      <span className="truncate font-medium" data-session-options-summary="">
        {summaryText}
      </span>
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={snapshot}
        isWorking={isDispatching}
      />
    </div>
  )
}

/** The label of the value a select option currently has, or null when it is unknown. */
function currentChoiceLabel(
  snapshot: readonly SessionOptionDescriptor[],
  match: (descriptor: SessionOptionDescriptor) => boolean
): string | null {
  const descriptor = snapshot.find(match)
  if (!descriptor || descriptor.kind.type !== 'select') {
    return null
  }
  const current = descriptor.kind.currentValue
  return descriptor.kind.choices.find((choice) => choice.value === current)?.label ?? null
}
