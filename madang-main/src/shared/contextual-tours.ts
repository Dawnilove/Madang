import type { ContextualTour, ContextualTourId } from './contextual-tour-types'

export type {
  ContextualTourId,
  ContextualTourStepControl,
  ContextualTourStepActionKind,
  ContextualTourStepAction,
  ContextualTourStepPlacement,
  ContextualTourStep,
  ContextualTour
} from './contextual-tour-types'

export const CONTEXTUAL_TOURS = [
  {
    id: 'workspace-board',
    steps: [
      {
        id: 'workspace-board-plan',
        title: 'Plan work on the board',
        body: 'Use the board when you want to see workspaces by status instead of by project.',
        targetSelector: '[data-contextual-tour-target="workspace-board-center"]',
        requiredForStart: true,
        preferredPlacement: 'bottom'
      },
      {
        id: 'workspace-board-lanes',
        title: 'Move work through lanes',
        body: 'Drag workspaces between lanes as their status changes.',
        targetSelector:
          '[data-contextual-tour-target="workspace-board-done-lane"], [data-contextual-tour-target="workspace-board-lanes"]'
      }
    ]
  },
  {
    id: 'workspace-agent-sessions',
    steps: [
      {
        id: 'workspace-agent-sessions-split',
        title: 'Split a terminal pane',
        body: 'Open a second terminal pane with {terminal.splitRight}, or right-click the pane for split options.',
        targetSelector:
          '[data-contextual-tour-target="terminal-pane-split-target"], [data-contextual-tour-target="workspace-agent-terminal-tip"]',
        requiredForStart: true,
        preferredPlacement: 'bottom',
        primaryAction: { kind: 'split-terminal-pane', label: 'Split terminal' },
        advanceOnFeatureInteraction: 'terminal-pane-split'
      },
      {
        id: 'workspace-agent-sessions-parallel',
        title: 'Start another task in parallel',
        body: 'Each worktree gets its own branch, so parallel work stays separate.',
        targetSelector: '[data-contextual-tour-target="workspace-create-control"]',
        preferredPlacement: 'right',
        targetPulse: true,
        hidePrimaryAction: true
      }
    ]
  },
  {
    id: 'browser',
    steps: [
      {
        id: 'browser-grab',
        title: 'Grab page context for agents',
        body: "Use the grab tool to copy a page element's context for agents.",
        targetSelector: '[data-contextual-tour-target="browser-grab-control"]',
        requiredForStart: true,
        preferredPlacement: 'bottom'
      },
      {
        id: 'browser-annotate',
        title: 'Mark design feedback in place',
        body: 'Annotate elements and send those notes to an agent.',
        targetSelector: '[data-contextual-tour-target="browser-annotation-control"]',
        preferredPlacement: 'bottom'
      },
      {
        id: 'browser-login',
        title: 'Stay logged in',
        body: 'Bring your existing logins into Madang to stay signed in immediately.',
        // Prefer visible Import; use overflow after the hint is dismissed.
        targetSelector:
          '[data-contextual-tour-target="browser-import-hint"], [data-contextual-tour-target="browser-import-cookies-control"]',
        preferredPlacement: 'bottom'
      }
    ]
  },
  {
    id: 'client-hosted-browser',
    steps: [
      {
        id: 'client-hosted-browser-intro',
        title: 'This page renders on your desktop',
        body: 'Remote browser tabs now render on this device. Network traffic still goes through the remote host.',
        targetSelector: '[data-contextual-tour-target="client-hosted-browser-controls"]',
        requiredForStart: true,
        preferredPlacement: 'bottom',
        primaryAction: { kind: 'complete', label: 'Got it' },
        secondaryAction: { kind: 'open-client-hosted-browser-settings', label: 'Browser settings' }
      }
    ]
  },
  {
    id: 'tasks',
    steps: [
      {
        id: 'tasks-source',
        title: 'Choose the work source',
        body: 'Switch between connected providers and project filters without changing pages.',
        targetSelector: '[data-contextual-tour-target="tasks-source-filters"]',
        requiredForStart: true
      },
      {
        id: 'tasks-filter',
        title: 'Filter to the work you need',
        body: 'Use presets and search to narrow issues, reviews, merge requests, or tasks.',
        targetSelector: '[data-contextual-tour-target="tasks-search-presets"]'
      },
      {
        id: 'tasks-start',
        title: 'Start from work items',
        body: 'Use Start or Open on a task, issue, review, or merge request to bring its context into a workspace.',
        targetSelector:
          '[data-contextual-tour-target="tasks-start-workspace"], [data-contextual-tour-target="tasks-actions"], [data-contextual-tour-target="tasks-search-presets"]'
      }
    ]
  },
  {
    id: 'automations',
    steps: [
      {
        id: 'automations-intro',
        title: 'What is an automation?',
        body: 'Automations run agent work on a schedule. Add an automation by clicking this button.',
        targetSelector: '[data-contextual-tour-target="automations-create"]',
        requiredForStart: true
      },
      {
        id: 'automations-results',
        title: 'Find the results',
        body: 'Runs show when automations ran, what happened, and where to inspect their output.',
        targetSelector: '[data-contextual-tour-target="automations-runs"]'
      }
    ]
  },
  {
    id: 'floating-workspace',
    steps: [
      {
        id: 'floating-workspace-repos',
        title: 'Run an agent across every repo',
        body: 'Agents here run in any folder you choose. Point one at the directory above your services to work across all your repos at once.',
        // Action anchors exist only in empty state; use the panel when floating tabs already exist.
        targetSelector:
          '[data-contextual-tour-target="floating-workspace-new-terminal"], [data-contextual-tour-target="floating-workspace-surface"]',
        requiredForStart: true,
        preferredPlacement: 'left'
      },
      {
        id: 'floating-workspace-scratchpad',
        title: 'Or use it as a scratchpad',
        body: 'Open agents, scratch terminals, notes, and browser tabs without cluttering the worktree you’re focused on.',
        targetSelector:
          '[data-contextual-tour-target="floating-workspace-new-markdown"], [data-contextual-tour-target="floating-workspace-surface"]',
        preferredPlacement: 'left'
      }
    ]
  },
  {
    id: 'workspace-creation',
    allowedActiveModals: ['new-workspace-composer'],
    steps: [
      {
        id: 'workspace-creation-project',
        title: 'Pick a project',
        body: 'Madang isolates each task in its own worktree, branched off your base.',
        targetSelector: '[data-contextual-tour-target="workspace-creation-project"]',
        requiredForStart: true
      },
      {
        id: 'workspace-creation-name',
        title: 'Name it, or start from existing work',
        body: 'Start from a linked task for a short issue or PR name. Or leave it blank to auto-name it from your first agent message.',
        targetSelector: '[data-contextual-tour-target="workspace-creation-name"]',
        control: { kind: 'auto-rename-branch-from-work' }
      },
      {
        id: 'workspace-creation-agent',
        title: 'Choose what agent starts the work',
        body: 'Pick the agent that should be opened when this worktree is created.',
        targetSelector: '[data-contextual-tour-target="workspace-creation-agent"]'
      }
    ]
  },
  {
    id: 'madang-intro',
    steps: [
      {
        id: 'madang-intro-sidebar',
        title: 'Projects and workspaces',
        body: 'Workspaces are grouped by project on the left. Use New workspace to start one, and the folder icon to add a project.',
        targetSelector: '[data-madang-conversation-sidebar]',
        requiredForStart: true,
        preferredPlacement: 'right'
      },
      {
        id: 'madang-intro-start',
        title: 'Start here',
        body: 'Type what you want to do and press Enter. Madang creates a workspace and starts the agent.',
        targetSelector: '[data-madang-first-prompt]',
        preferredPlacement: 'bottom'
      },
      {
        id: 'madang-intro-row',
        title: 'See status at a glance',
        body: 'The dot shows agent status. The title follows the linked issue or PR. Each row lists its agents below.',
        targetSelector: '[data-conversation-id]',
        preferredPlacement: 'right'
      },
      {
        id: 'madang-intro-collab',
        title: 'Agents working together',
        body: 'Ask Claude or Codex, "Take the lead and split the work." The lead agent hands tasks to other agents and reports the combined result. Workers show up as indented rows in this list.',
        targetSelector: '[data-worktree-sidebar]',
        preferredPlacement: 'right'
      },
      {
        id: 'madang-intro-environment',
        title: 'Environment card',
        body: 'Shows where this workspace runs, its project folder, and its branch. Add a project folder or start a new workspace here.',
        targetSelector: '[data-contextual-tour-target="madang-environment-card"]',
        preferredPlacement: 'left'
      },
      {
        id: 'madang-intro-agents',
        title: 'Agent history',
        body: 'Find and reopen past agent sessions. The window button at the top opens your Claude desktop sessions as tabs in this project.',
        targetSelector: '[data-contextual-tour-target="right-sidebar-tab-vault"]',
        preferredPlacement: 'left'
      },
      {
        id: 'madang-intro-source',
        title: 'Source control and PR',
        body: 'Review changed files and commit them. Use Create PR at the top to open a PR.',
        targetSelector: '[data-contextual-tour-target="right-sidebar-tab-source-control"]',
        preferredPlacement: 'left'
      },
      {
        id: 'madang-intro-settings',
        title: 'Settings and replay',
        body: 'Switch themes in Settings. You can replay this tour any time from the Help (?) menu.',
        targetSelector: '[data-contextual-tour-target="sidebar-settings"]',
        preferredPlacement: 'top'
      }
    ]
  }
] as const satisfies readonly ContextualTour[]

export const CONTEXTUAL_TOUR_IDS = CONTEXTUAL_TOURS.map((tour) => tour.id)

export function isContextualTourId(value: unknown): value is ContextualTourId {
  return typeof value === 'string' && CONTEXTUAL_TOUR_IDS.includes(value as ContextualTourId)
}

export function getContextualTour(id: ContextualTourId): ContextualTour {
  return CONTEXTUAL_TOURS.find((tour) => tour.id === id)!
}

export function normalizeContextualTourIds(value: unknown): ContextualTourId[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<ContextualTourId>()
  for (const item of value) {
    if (isContextualTourId(item)) {
      seen.add(item)
    }
  }
  return [...seen]
}
