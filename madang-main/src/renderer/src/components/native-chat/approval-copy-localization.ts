import { translate } from '@/i18n/i18n'

const KEY = 'components.native-chat.approval'
const MAX_SUMMARY_CHARS = 300
const APPROVAL_TITLE = /^Allow (.+)\?$/

export type ApprovalSummary = { label: string; value: string }

// Why: providers journal these strings in English; the card localizes them at render so stored history stays portable.
const TOOL_NAMES = new Map<string, () => string>([
  ['WebSearch', () => translate(`${KEY}.tool.webSearch`, 'WebSearch')],
  ['WebFetch', () => translate(`${KEY}.tool.webFetch`, 'WebFetch')],
  ['Bash', () => translate(`${KEY}.tool.bash`, 'Bash')],
  ['Read', () => translate(`${KEY}.tool.read`, 'Read')],
  ['Write', () => translate(`${KEY}.tool.write`, 'Write')],
  ['Edit', () => translate(`${KEY}.tool.edit`, 'Edit')],
  ['MultiEdit', () => translate(`${KEY}.tool.edit`, 'Edit')],
  ['NotebookEdit', () => translate(`${KEY}.tool.edit`, 'Edit')],
  ['Glob', () => translate(`${KEY}.tool.glob`, 'Glob')],
  ['Grep', () => translate(`${KEY}.tool.grep`, 'Grep')],
  ['Task', () => translate(`${KEY}.tool.agent`, 'Task')],
  ['Agent', () => translate(`${KEY}.tool.agent`, 'Task')]
])

const OPTION_LABELS = new Map<string, () => string>([
  ['Allow', () => translate(`${KEY}.allow`, 'Allow')],
  ['Deny', () => translate(`${KEY}.deny`, 'Deny')],
  ['Allow for this session', () => translate(`${KEY}.allowForSession`, 'Allow for this session')],
  ['Stop', () => translate(`${KEY}.stop`, 'Stop')],
  ['Approve plan', () => translate(`${KEY}.planApprove`, 'Approve plan')],
  ['Keep planning', () => translate(`${KEY}.planKeep`, 'Keep planning')]
])

// Which input field says what the tool will do; the raw JSON stays on the card as the source of truth.
const SUMMARY_FIELDS = new Map<string, { fields: readonly string[]; label: () => string }>([
  ['WebSearch', { fields: ['query'], label: () => translate(`${KEY}.summary.query`, 'Query') }],
  ['WebFetch', { fields: ['url'], label: () => translate(`${KEY}.summary.url`, 'URL') }],
  ['Bash', { fields: ['command'], label: () => translate(`${KEY}.summary.command`, 'Command') }],
  ['Read', { fields: ['file_path'], label: () => translate(`${KEY}.summary.file`, 'File') }],
  ['Write', { fields: ['file_path'], label: () => translate(`${KEY}.summary.file`, 'File') }],
  ['Edit', { fields: ['file_path'], label: () => translate(`${KEY}.summary.file`, 'File') }],
  ['MultiEdit', { fields: ['file_path'], label: () => translate(`${KEY}.summary.file`, 'File') }],
  [
    'NotebookEdit',
    { fields: ['notebook_path'], label: () => translate(`${KEY}.summary.file`, 'File') }
  ],
  ['Glob', { fields: ['pattern'], label: () => translate(`${KEY}.summary.pattern`, 'Pattern') }],
  ['Grep', { fields: ['pattern'], label: () => translate(`${KEY}.summary.pattern`, 'Pattern') }]
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function approvalToolName(title: string): string | null {
  return APPROVAL_TITLE.exec(title)?.[1] ?? null
}

export function localizeApprovalToolName(name: string): string {
  return TOOL_NAMES.get(name)?.() ?? name
}

export function localizeApprovalTitle(title: string): string {
  if (title === 'Review proposed plan') {
    return translate(`${KEY}.plan.reviewTitle`, 'Review proposed plan')
  }
  const tool = approvalToolName(title)
  if (!tool) {
    return title
  }
  return translate(`${KEY}.title`, 'Allow {{value0}}?', {
    value0: localizeApprovalToolName(tool)
  })
}

export function localizeApprovalOptionLabel(label: string): string {
  return OPTION_LABELS.get(label)?.() ?? label
}

/** One plain line on what the tool will do; null when the input is unknown, cut off, or not JSON. */
export function summarizeApprovalRequest(
  title: string,
  detail: string | undefined
): ApprovalSummary | null {
  const tool = approvalToolName(title)
  const spec = tool ? SUMMARY_FIELDS.get(tool) : undefined
  if (!spec || !detail) {
    return null
  }
  let input: unknown
  try {
    input = JSON.parse(detail)
  } catch {
    return null
  }
  if (!isRecord(input)) {
    return null
  }
  for (const field of spec.fields) {
    const value = input[field]
    if (typeof value === 'string' && value.length > 0) {
      const shown =
        value.length > MAX_SUMMARY_CHARS ? `${value.slice(0, MAX_SUMMARY_CHARS)}…` : value
      return { label: spec.label(), value: shown }
    }
  }
  return null
}
