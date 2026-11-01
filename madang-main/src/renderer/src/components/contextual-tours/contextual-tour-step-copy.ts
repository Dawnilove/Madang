import { translate } from '@/i18n/i18n'
import type { ContextualTourStepAction } from '../../../../shared/contextual-tours'

const TOUR_COPY_KEY = 'auto.components.contextual.tours.contextual.tour.overlay.measurement'

function tourStepCopy(
  path: string,
  title: string,
  body: string
): { title: () => string; body: () => string } {
  // Madang's own tours keep short `madang.*` keys; upstream steps keep the auto-extracted prefix.
  const prefix = path.startsWith('madang.') ? path : `${TOUR_COPY_KEY}.${path}`
  return {
    title: () => translate(`${prefix}.title`, title),
    body: () => translate(`${prefix}.body`, body)
  }
}

// [step id, catalog path, English title, English body]; the catalog path is the id with dots.
const TOUR_STEP_COPY: readonly (readonly [string, string, string, string])[] = [
  [
    'workspace-board-plan',
    'workspace.board.plan',
    'Plan work on the board',
    'Use the board when you want to see workspaces by status instead of by project.'
  ],
  [
    'workspace-board-lanes',
    'workspace.board.lanes',
    'Move work through lanes',
    'Drag workspaces between lanes as their status changes.'
  ],
  [
    'workspace-agent-sessions-split',
    'workspace.agent.sessions.split',
    'Split a terminal pane',
    'Open a second terminal pane with {terminal.splitRight}, or right-click the pane for split options.'
  ],
  [
    'workspace-agent-sessions-parallel',
    'workspace.agent.sessions.parallel',
    'Start another task in parallel',
    'Each worktree gets its own branch, so parallel work stays separate.'
  ],
  [
    'browser-grab',
    'browser.grab',
    'Grab page context for agents',
    "Use the grab tool to copy a page element's context for agents."
  ],
  [
    'browser-annotate',
    'browser.annotate',
    'Mark design feedback in place',
    'Annotate elements and send those notes to an agent.'
  ],
  [
    'browser-login',
    'browser.login',
    'Stay logged in',
    'Bring your existing logins into Madang to stay signed in immediately.'
  ],
  [
    'tasks-source',
    'tasks.source',
    'Choose the work source',
    'Switch between connected providers and project filters without changing pages.'
  ],
  [
    'tasks-filter',
    'tasks.filter',
    'Filter to the work you need',
    'Use presets and search to narrow issues, reviews, merge requests, or tasks.'
  ],
  [
    'tasks-start',
    'tasks.start',
    'Start from work items',
    'Use Start or Open on a task, issue, review, or merge request to bring its context into a workspace.'
  ],
  [
    'floating-workspace-repos',
    'floating.workspace.repos',
    'Run an agent across every repo',
    'Agents here run in any folder you choose. Point one at the directory above your services to work across all your repos at once.'
  ],
  [
    'floating-workspace-scratchpad',
    'floating.workspace.scratchpad',
    'Or use it as a scratchpad',
    'Open agents, scratch terminals, notes, and browser tabs without cluttering the worktree you’re focused on.'
  ],
  [
    'workspace-creation-project',
    'workspace.creation.project',
    'Pick a project',
    'Madang isolates each task in its own worktree, branched off your base.'
  ],
  [
    'workspace-creation-name',
    'workspace.creation.name',
    'Name it, or start from existing work',
    'Start from a linked task for a short issue or PR name. Or leave it blank to auto-name it from your first agent message.'
  ],
  [
    'workspace-creation-agent',
    'workspace.creation.agent',
    'Choose what agent starts the work',
    'Pick the agent that should be opened when this worktree is created.'
  ],
  [
    'madang-intro-start',
    'madang.tour.start',
    'Start here',
    'Type what you want to do and press Enter. Madang creates a workspace and starts the agent.'
  ],
  [
    'madang-intro-sidebar',
    'madang.tour.sidebar',
    'Projects and workspaces',
    'Workspaces are grouped by project on the left. Use New workspace to start one, and the folder icon to add a project.'
  ],
  [
    'madang-intro-row',
    'madang.tour.row',
    'See status at a glance',
    'The dot shows agent status. The title follows the linked issue or PR. Each row lists its agents below.'
  ],
  [
    'madang-intro-collab',
    'madang.tour.collab',
    'Agents working together',
    'Ask Claude or Codex, "Take the lead and split the work." The lead agent hands tasks to other agents and reports the combined result. Workers show up as indented rows in this list.'
  ],
  [
    'madang-intro-environment',
    'madang.tour.environment',
    'Environment card',
    'Shows where this workspace runs, its project folder, and its branch. Add a project folder or start a new workspace here.'
  ],
  [
    'madang-intro-agents',
    'madang.tour.agents',
    'Agent history',
    'Find and reopen past agent sessions. The window button at the top opens your Claude desktop sessions as tabs in this project.'
  ],
  [
    'madang-intro-source',
    'madang.tour.source',
    'Source control and PR',
    'Review changed files and commit them. Use Create PR at the top to open a PR.'
  ],
  [
    'madang-intro-settings',
    'madang.tour.settings',
    'Settings and replay',
    'Switch themes in Settings. You can replay this tour any time from the Help (?) menu.'
  ]
]

// Key translated thunks by stable step IDs so insertions cannot shift copy and language resolves at render time.
export const LOCALIZED_STEP_COPY: Record<string, { title: () => string; body: () => string }> = {
  'automations-intro': {
    title: () =>
      translate(
        'auto.components.contextual.tours.contextual.tour.overlay.measurement.automations.intro.title',
        'What is an automation?'
      ),
    body: () =>
      translate(
        'auto.components.contextual.tours.contextual.tour.overlay.measurement.automations.intro.body',
        'Automations run agent work on a schedule. Add an automation by clicking this button.'
      )
  },
  'client-hosted-browser-intro': {
    title: () =>
      translate(
        'auto.components.contextual.tours.contextual.tour.overlay.measurement.client.hosted.browser.intro.title',
        'This page renders on your desktop'
      ),
    body: () =>
      translate(
        'auto.components.contextual.tours.contextual.tour.overlay.measurement.client.hosted.browser.intro.body',
        'Remote browser tabs now render on this device. Network traffic still goes through the remote host.'
      )
  },
  'automations-results': {
    title: () =>
      translate(
        'auto.components.contextual.tours.contextual.tour.overlay.measurement.automations.results.title',
        'Find the results'
      ),
    body: () =>
      translate(
        'auto.components.contextual.tours.contextual.tour.overlay.measurement.automations.results.body',
        'Runs show when automations ran, what happened, and where to inspect their output.'
      )
  },
  ...Object.fromEntries(
    TOUR_STEP_COPY.map(([id, path, title, body]) => [id, tourStepCopy(path, title, body)])
  )
}

const ACTION_LABELS = new Map<string, () => string>([
  ['Split terminal', () => translate(`${TOUR_COPY_KEY}.actions.split.terminal`, 'Split terminal')],
  ['Got it', () => translate(`${TOUR_COPY_KEY}.actions.got.it`, 'Got it')],
  [
    'Browser settings',
    () => translate(`${TOUR_COPY_KEY}.actions.browser.settings`, 'Browser settings')
  ]
])

export function localizeStepAction(
  action: ContextualTourStepAction | undefined
): ContextualTourStepAction | undefined {
  return action ? { ...action, label: ACTION_LABELS.get(action.label)?.() ?? action.label } : action
}
