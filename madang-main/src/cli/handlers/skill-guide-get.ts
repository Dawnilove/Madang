import type { CommandHandler } from '../dispatch'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import { writeStdoutLine } from '../stdout-line'
import {
  loadCanonicalGuides,
  requireTopic,
  type BundledSkillGuide,
  type BundledSkillGuideReference
} from './bundled-skill-guide-table'

type GuideSelection = { full: boolean; reference: string | null; listReferences: boolean }

// Accept references/<file>.md exactly as published in the kernel's gate table.
function normalizeReferenceSelector(value: string): string {
  return value
    .trim()
    .replace(/^references\//, '')
    .replace(/\.md$/, '')
}

function resolveSelection(flags: Map<string, string | boolean>): GuideSelection {
  const full = flags.has('full')
  const listReferences = flags.get('references') === true
  const requested = flags.get('reference')
  const hasReference = flags.has('reference')
  if (listReferences && full) {
    throw new RuntimeClientError('invalid_argument', 'Use either --references or --full, not both.')
  }
  if (listReferences && hasReference) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Use either --references or --reference, not both.'
    )
  }
  if (full && hasReference) {
    throw new RuntimeClientError('invalid_argument', 'Use either --full or --reference, not both.')
  }
  if (hasReference && (typeof requested !== 'string' || requested.trim().length === 0)) {
    throw new RuntimeClientError('invalid_argument', 'Missing required --reference')
  }
  return {
    full,
    reference: typeof requested === 'string' ? requested : null,
    listReferences
  }
}

const COLLABORATION_GUIDE_NAME = 'collaboration'
const COLLABORATION_RULES_OFF_MARKDOWN = [
  '# 협업 규칙: 꺼짐',
  '',
  '협업 규칙이 꺼져 있다. 이 규칙을 적용하지 않는다.',
  '1. 사용자의 입력을 평소처럼 처리한다. 총괄 세션이 되지 않는다.',
  '2. 사용자에게 한 줄로 알린다: "협업 규칙이 꺼져 있습니다. Madang 설정 > 실험 기능 > 협업 규칙을 켜세요."',
  '3. 스위치를 대신 켜지 않는다.'
].join('\n')

// Fail closed: an unreadable setting must not switch multi-agent behavior on.
async function collaborationRulesEnabled(client: RuntimeClient): Promise<boolean> {
  try {
    const response = await client.call<{ settings?: { experimentalCollaboration?: boolean } }>(
      'settings.get'
    )
    return response.result?.settings?.experimentalCollaboration === true
  } catch {
    return false
  }
}

function requireReferences(guide: BundledSkillGuide): readonly BundledSkillGuideReference[] {
  if (guide.references.length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Guide "${guide.name}" has no bundled references.`
    )
  }
  return guide.references
}

function requireReference(guide: BundledSkillGuide, requested: string): BundledSkillGuideReference {
  const references = requireReferences(guide)
  const selector = normalizeReferenceSelector(requested)
  const match = references.find((reference) => reference.name === selector)
  if (!match) {
    const available = references.map((reference) => reference.name).join(', ')
    throw new RuntimeClientError(
      'invalid_argument',
      `Unknown reference "${requested}" for ${guide.name}. Available: ${available}`
    )
  }
  return match
}

export const SKILL_GUIDE_GET_HANDLER: Record<string, CommandHandler> = {
  'skills get': async (ctx) => {
    // ctx.client is a lazy getter: only the collaboration topic may touch it.
    const { flags, json } = ctx
    const selection = resolveSelection(flags)
    const guides = await loadCanonicalGuides()
    const guide = requireTopic(flags, guides)

    if (guide.name === COLLABORATION_GUIDE_NAME && !(await collaborationRulesEnabled(ctx.client))) {
      writeStdoutLine(
        json
          ? JSON.stringify(
              { name: guide.name, enabled: false, markdown: COLLABORATION_RULES_OFF_MARKDOWN },
              null,
              2
            )
          : COLLABORATION_RULES_OFF_MARKDOWN
      )
      return
    }

    if (selection.listReferences) {
      const names = requireReferences(guide).map((reference) => reference.name)
      writeStdoutLine(
        json ? JSON.stringify({ name: guide.name, references: names }, null, 2) : names.join('\n')
      )
      return
    }

    if (selection.reference !== null) {
      const reference = requireReference(guide, selection.reference)
      writeStdoutLine(
        json
          ? JSON.stringify(
              { name: guide.name, reference: reference.name, markdown: reference.markdown },
              null,
              2
            )
          : reference.markdown
      )
      return
    }

    const markdown = selection.full ? guide.fullMarkdown : guide.markdown
    writeStdoutLine(
      json
        ? JSON.stringify({ name: guide.name, full: selection.full, markdown }, null, 2)
        : markdown
    )
  }
}
