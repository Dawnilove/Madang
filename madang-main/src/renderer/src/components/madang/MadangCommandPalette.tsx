import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  FilePlus,
  FileSearch,
  FolderPlus,
  GitBranch,
  Keyboard,
  Languages,
  LayoutPanelLeft,
  LayoutPanelTop,
  Moon,
  PanelBottom,
  Search,
  Settings,
  SquareKanban
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import { addAppKeyListener, removeAppKeyListener } from '@/lib/app-keyboard-router'
import { dispatchAppCommand } from '@/lib/app-command-dispatch'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '@/components/settings/settings-search-keywords'
import { useAppStore } from '@/store'
import type { KeybindingActionId } from '../../../../shared/keybindings'
import {
  useMadangFeatureToggleCommands,
  type PaletteCommand
} from './madang-feature-toggle-commands'

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/** Ctrl+Shift+P (Cmd+Shift+P on macOS), the VS Code / JetDeck command palette chord. */
function isPaletteChord(event: KeyboardEvent): boolean {
  const mod = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return mod && event.shiftKey && !event.altKey && event.code === 'KeyP'
}

function runAppCommand(actionId: KeybindingActionId): void {
  dispatchAppCommand(actionId, 'plugin-palette')
}

function ShortcutHint({ actionId }: { actionId: KeybindingActionId }): React.JSX.Element | null {
  const details = useShortcutKeyDetails(actionId)
  if (details.keys.length === 0) {
    return null
  }
  return <ShortcutKeyCombo keys={details.keys} doubleTap={details.doubleTap} className="ml-auto" />
}

function useMadangPaletteCommands(): PaletteCommand[] {
  const openModal = useAppStore((s) => s.openModal)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const setStatusBarVisible = useAppStore((s) => s.setStatusBarVisible)
  const statusBarVisible = useAppStore((s) => s.statusBarVisible)
  const theme = useAppStore((s) => s.settings?.theme)
  const uiLanguage = useAppStore((s) => s.settings?.uiLanguage)
  const featureCommands = useMadangFeatureToggleCommands()

  // Why: rebuilt each render so titles follow a language switch; the list is small.
  useTranslation()
  return [
    {
      id: 'workspace.switch',
      group: 'workspace',
      title: translate('madang.commandPalette.switchWorkspace', 'Switch workspace…'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.workspace', 'workspace'),
        ...translateSearchKeyword('madang.commandPalette.keyword.worktree', 'worktree'),
        ...translateSearchKeyword('madang.commandPalette.keyword.jump', 'jump'),
        ...translateSearchKeyword('madang.commandPalette.keyword.search', 'search')
      ],
      icon: Search,
      shortcutId: 'worktree.palette',
      run: () => openModal('worktree-palette')
    },
    {
      id: 'workspace.goToFile',
      group: 'workspace',
      title: translate('madang.commandPalette.goToFile', 'Go to file…'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.file', 'file'),
        ...translateSearchKeyword('madang.commandPalette.keyword.open', 'open'),
        ...translateSearchKeyword('madang.commandPalette.keyword.quickOpen', 'quick open')
      ],
      icon: FileSearch,
      shortcutId: 'worktree.quickOpen',
      run: () => openModal('quick-open')
    },
    {
      id: 'workspace.create',
      group: 'workspace',
      title: translate('madang.commandPalette.newWorkspace', 'New workspace'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.create', 'create'),
        ...translateSearchKeyword('madang.commandPalette.keyword.worktree', 'worktree'),
        ...translateSearchKeyword('madang.commandPalette.keyword.branch', 'branch')
      ],
      icon: GitBranch,
      shortcutId: 'workspace.create',
      run: () => openModal('new-workspace-composer', { telemetrySource: 'unknown' })
    },
    {
      id: 'project.add',
      group: 'workspace',
      title: translate('madang.commandPalette.addProject', 'Add project…'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.repo', 'repo'),
        ...translateSearchKeyword('madang.commandPalette.keyword.folder', 'folder'),
        ...translateSearchKeyword('madang.commandPalette.keyword.clone', 'clone')
      ],
      icon: FolderPlus,
      run: () => openModal('add-repo')
    },
    {
      id: 'workspace.board',
      group: 'workspace',
      title: translate('madang.commandPalette.workspaceBoard', 'Open workspace board'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.kanban', 'kanban'),
        ...translateSearchKeyword('madang.commandPalette.keyword.board', 'board'),
        ...translateSearchKeyword('madang.commandPalette.keyword.overview', 'overview')
      ],
      icon: SquareKanban,
      shortcutId: 'workspace.openBoard',
      run: () => runAppCommand('workspace.openBoard')
    },
    {
      id: 'history.back',
      group: 'workspace',
      title: translate('madang.commandPalette.back', 'Go back to previous workspace'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.history', 'history'),
        ...translateSearchKeyword('madang.commandPalette.keyword.back', 'back'),
        ...translateSearchKeyword('madang.commandPalette.keyword.previous', 'previous')
      ],
      icon: ArrowLeft,
      shortcutId: 'worktree.history.back',
      run: () => runAppCommand('worktree.history.back')
    },
    {
      id: 'history.forward',
      group: 'workspace',
      title: translate('madang.commandPalette.forward', 'Go forward to next workspace'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.history', 'history'),
        ...translateSearchKeyword('madang.commandPalette.keyword.forward', 'forward'),
        ...translateSearchKeyword('madang.commandPalette.keyword.next', 'next')
      ],
      icon: ArrowRight,
      shortcutId: 'worktree.history.forward',
      run: () => runAppCommand('worktree.history.forward')
    },
    {
      id: 'view.leftSidebar',
      group: 'view',
      title: translate('madang.commandPalette.toggleLeftSidebar', 'Toggle left sidebar'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.sidebar', 'sidebar'),
        ...translateSearchKeyword('madang.commandPalette.keyword.projects', 'projects'),
        ...translateSearchKeyword('madang.commandPalette.keyword.hide', 'hide'),
        ...translateSearchKeyword('madang.commandPalette.keyword.show', 'show')
      ],
      icon: LayoutPanelLeft,
      shortcutId: 'sidebar.left.toggle',
      run: () => runAppCommand('sidebar.left.toggle')
    },
    {
      id: 'view.rightSidebar',
      group: 'view',
      title: translate('madang.commandPalette.toggleRightSidebar', 'Toggle right panel'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.sidebar', 'sidebar'),
        ...translateSearchKeyword('madang.commandPalette.keyword.files', 'files'),
        ...translateSearchKeyword('madang.commandPalette.keyword.panel', 'panel'),
        ...translateSearchKeyword('madang.commandPalette.keyword.hide', 'hide'),
        ...translateSearchKeyword('madang.commandPalette.keyword.show', 'show')
      ],
      icon: LayoutPanelTop,
      shortcutId: 'sidebar.right.toggle',
      run: () => runAppCommand('sidebar.right.toggle')
    },
    {
      id: 'view.explorer',
      group: 'view',
      title: translate('madang.commandPalette.explorer', 'Show file explorer'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.files', 'files'),
        ...translateSearchKeyword('madang.commandPalette.keyword.tree', 'tree'),
        ...translateSearchKeyword('madang.commandPalette.keyword.explorer', 'explorer')
      ],
      icon: FilePlus,
      shortcutId: 'sidebar.explorer.toggle',
      run: () => runAppCommand('sidebar.explorer.toggle')
    },
    {
      id: 'view.search',
      group: 'view',
      title: translate('madang.commandPalette.search', 'Search in files'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.find', 'find'),
        ...translateSearchKeyword('madang.commandPalette.keyword.grep', 'grep'),
        ...translateSearchKeyword('madang.commandPalette.keyword.search', 'search')
      ],
      icon: Search,
      shortcutId: 'sidebar.search.toggle',
      run: () => runAppCommand('sidebar.search.toggle')
    },
    {
      id: 'view.sourceControl',
      group: 'view',
      title: translate('madang.commandPalette.sourceControl', 'Show source control'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.git', 'git'),
        ...translateSearchKeyword('madang.commandPalette.keyword.changes', 'changes'),
        ...translateSearchKeyword('madang.commandPalette.keyword.commit', 'commit'),
        ...translateSearchKeyword('madang.commandPalette.keyword.diff', 'diff')
      ],
      icon: GitBranch,
      shortcutId: 'sidebar.sourceControl.toggle',
      run: () => runAppCommand('sidebar.sourceControl.toggle')
    },
    {
      id: 'view.statusBar',
      group: 'view',
      title: statusBarVisible
        ? translate('madang.commandPalette.hideStatusBar', 'Hide status bar')
        : translate('madang.commandPalette.showStatusBar', 'Show status bar'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.status', 'status'),
        ...translateSearchKeyword('madang.commandPalette.keyword.bar', 'bar'),
        ...translateSearchKeyword('madang.commandPalette.keyword.bottom', 'bottom')
      ],
      icon: PanelBottom,
      run: () => setStatusBarVisible(!statusBarVisible)
    },
    {
      id: 'view.theme',
      group: 'view',
      title:
        theme === 'light'
          ? translate('madang.commandPalette.useDarkTheme', 'Use dark theme')
          : translate('madang.commandPalette.useLightTheme', 'Use light theme'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.theme', 'theme'),
        ...translateSearchKeyword('madang.commandPalette.keyword.dark', 'dark'),
        ...translateSearchKeyword('madang.commandPalette.keyword.light', 'light'),
        ...translateSearchKeyword('madang.commandPalette.keyword.appearance', 'appearance')
      ],
      icon: Moon,
      run: () => void updateSettings({ theme: theme === 'light' ? 'dark' : 'light' })
    },
    ...featureCommands,
    {
      id: 'general.language',
      group: 'general',
      title:
        uiLanguage === 'ko'
          ? translate('madang.commandPalette.useEnglish', 'Switch language to English')
          : translate('madang.commandPalette.useKorean', 'Switch language to Korean (한국어)'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.language', 'language'),
        ...translateSearchKeyword('madang.commandPalette.keyword.korean', 'korean', {
          aliases: ['한국어']
        }),
        ...translateSearchKeyword('madang.commandPalette.keyword.english', 'english')
      ],
      icon: Languages,
      run: () => void updateSettings({ uiLanguage: uiLanguage === 'ko' ? 'en' : 'ko' })
    },
    {
      id: 'general.settings',
      group: 'general',
      title: translate('madang.commandPalette.settings', 'Open settings'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.preferences', 'preferences'),
        ...translateSearchKeyword('madang.commandPalette.keyword.options', 'options'),
        ...translateSearchKeyword('madang.commandPalette.keyword.config', 'config')
      ],
      icon: Settings,
      shortcutId: 'app.settings',
      run: () => openSettingsPage()
    },
    {
      id: 'general.shortcuts',
      group: 'general',
      title: translate('madang.commandPalette.shortcuts', 'Keyboard shortcuts'),
      keywords: [
        ...translateSearchKeyword('madang.commandPalette.keyword.keybindings', 'keybindings'),
        ...translateSearchKeyword('madang.commandPalette.keyword.keys', 'keys'),
        ...translateSearchKeyword('madang.commandPalette.keyword.hotkeys', 'hotkeys')
      ],
      icon: Keyboard,
      run: () => {
        openSettingsTarget({ pane: 'shortcuts', repoId: null })
        openSettingsPage()
      }
    }
  ]
}

/** Madang command palette: one searchable list of everyday commands, opened with Ctrl+Shift+P. */
export function MadangCommandPalette(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const commands = useMadangPaletteCommands()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPaletteChord(event)) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen((current) => !current)
    }
    addAppKeyListener('keydown', onKeyDown)
    return () => removeAppKeyListener('keydown', onKeyDown)
  }, [])

  const runCommand = useCallback((command: PaletteCommand) => {
    setOpen(false)
    // Why: let the dialog release focus before the command opens its own surface.
    window.setTimeout(command.run, 0)
  }, [])

  const groups: { id: PaletteCommand['group']; label: string }[] = [
    { id: 'workspace', label: translate('madang.commandPalette.groupWorkspace', 'Workspace') },
    { id: 'view', label: translate('madang.commandPalette.groupView', 'View') },
    { id: 'features', label: translate('madang.commandPalette.groupFeatures', 'Features') },
    { id: 'general', label: translate('madang.commandPalette.groupGeneral', 'General') }
  ]

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={translate('madang.commandPalette.title', 'Command palette')}
      description={translate('madang.commandPalette.description', 'Search for a command to run')}
    >
      <CommandInput
        placeholder={translate('madang.commandPalette.placeholder', 'Type a command…')}
      />
      <CommandList>
        <CommandEmpty>
          {translate('madang.commandPalette.empty', 'No matching command.')}
        </CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {commands
              .filter((command) => command.group === group.id)
              .map((command) => {
                const Icon = command.icon
                return (
                  <CommandItem
                    key={command.id}
                    value={`${command.title} ${command.keywords.join(' ')}`}
                    onSelect={() => runCommand(command)}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <span>{command.title}</span>
                    {command.shortcutId ? <ShortcutHint actionId={command.shortcutId} /> : null}
                  </CommandItem>
                )
              })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
