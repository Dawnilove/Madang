import type { LucideIcon } from 'lucide-react'
import { CalendarClock, ListChecks, MessagesSquare, Plug } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '@/components/settings/settings-search-keywords'
import { useAppStore } from '@/store'
import type { KeybindingActionId } from '../../../../shared/keybindings'

export type PaletteCommand = {
  id: string
  group: 'general' | 'workspace' | 'view' | 'features'
  title: string
  keywords: string[]
  icon: LucideIcon
  shortcutId?: KeybindingActionId
  run: () => void
}

/** Palette commands that turn optional Madang features on and off. */
// Why: optional features stay one command away instead of buried in Settings (Madang product decision).
export function useMadangFeatureToggleCommands(): PaletteCommand[] {
  const updateSettings = useAppStore((s) => s.updateSettings)
  const showTasksButton = useAppStore((s) => s.settings?.showTasksButton !== false)
  const showAutomationsButton = useAppStore((s) => s.settings?.showAutomationsButton !== false)
  const pluginSystemEnabled = useAppStore((s) => s.settings?.pluginSystemEnabled === true)
  const chatUiEnabled = useAppStore((s) => s.settings?.experimentalNativeChat === true)

  return [
    {
      id: 'features.chatUi',
      group: 'features',
      title: chatUiEnabled
        ? translate(
            'madang.commandPalette.disableChatUi',
            'Turn off Chat UI (start agents in a terminal)'
          )
        : translate('madang.commandPalette.enableChatUi', 'Turn on Chat UI'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.chat', 'chat'),
        ...translateSearchKeyword('madang.commandPalette.keyword.features', 'features'),
        ...translateSearchKeyword('madang.commandPalette.keyword.agent', 'agent')
      ],
      icon: MessagesSquare,
      run: () => void updateSettings({ experimentalNativeChat: !chatUiEnabled })
    },
    {
      id: 'features.tasks',
      group: 'features',
      title: showTasksButton
        ? translate('madang.commandPalette.hideTasks', 'Hide Tasks in the sidebar')
        : translate('madang.commandPalette.showTasks', 'Show Tasks in the sidebar'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.tasks', 'tasks'),
        ...translateSearchKeyword('madang.commandPalette.keyword.features', 'features'),
        ...translateSearchKeyword('madang.commandPalette.keyword.issues', 'issues'),
        ...translateSearchKeyword('madang.commandPalette.keyword.sidebar', 'sidebar')
      ],
      icon: ListChecks,
      run: () => void updateSettings({ showTasksButton: !showTasksButton })
    },
    {
      id: 'features.automations',
      group: 'features',
      title: showAutomationsButton
        ? translate('madang.commandPalette.hideAutomations', 'Hide Automations in the sidebar')
        : translate('madang.commandPalette.showAutomations', 'Show Automations in the sidebar'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.automations', 'automations'),
        ...translateSearchKeyword('madang.commandPalette.keyword.features', 'features'),
        ...translateSearchKeyword('madang.commandPalette.keyword.schedule', 'schedule'),
        ...translateSearchKeyword('madang.commandPalette.keyword.sidebar', 'sidebar')
      ],
      icon: CalendarClock,
      run: () => void updateSettings({ showAutomationsButton: !showAutomationsButton })
    },
    {
      id: 'features.plugins',
      group: 'features',
      title: pluginSystemEnabled
        ? translate('madang.commandPalette.disablePlugins', 'Turn off plugins')
        : translate('madang.commandPalette.enablePlugins', 'Turn on plugins'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.plugins', 'plugins'),
        ...translateSearchKeyword('madang.commandPalette.keyword.features', 'features'),
        ...translateSearchKeyword('madang.commandPalette.keyword.extensions', 'extensions')
      ],
      icon: Plug,
      run: () => void updateSettings({ pluginSystemEnabled: !pluginSystemEnabled })
    }
  ]
}
