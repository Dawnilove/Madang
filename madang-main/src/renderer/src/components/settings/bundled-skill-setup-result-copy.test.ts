import { describe, expect, it } from 'vitest'
import {
  doneResult,
  planEntry,
  planOf,
  planOp,
  sharedEntry
} from '../skills/bundled-skill-plan-fixtures.test-support'
import { bundledSkillSetupChanges } from './bundled-skill-setup-copy'
import {
  bundledSkillSetupAttentionMessage,
  skillInstallResultLine
} from './bundled-skill-setup-result-copy'

function resultLine(plan: ReturnType<typeof planOf>): string {
  const result = doneResult(plan)
  return skillInstallResultLine(result, bundledSkillSetupChanges(plan, result))
}

describe('setup result details', () => {
  it.each([
    ['write', 'Installed'],
    ['update', 'Updated'],
    ['link', 'Linked'],
    ['keep', 'No change']
  ] as const)('uses the outcome API for a %s result without setup changes', (kind, headline) => {
    const result = doneResult(planOf([sharedEntry('madang-cli', kind)]))
    expect(skillInstallResultLine(result)).toBe(headline)
  })

  it('keeps an empty result unchanged without setup changes', () => {
    expect(skillInstallResultLine(doneResult(planOf([])))).toBe('No change')
  })

  it.each([
    ['edited', 'Skill edited outside Madang'],
    ['other', 'A different skill uses this name'],
    ['unwritable', "Madang can't write to this folder"],
    ['unreadable', "Madang can't read every file"],
    ['busy', 'Another install is still running'],
    ['shared-not-current', "The shared copy isn't Madang's"],
    [undefined, 'This copy was kept as it is']
  ] as const)('names the agent for a %s copy', (reason, text) => {
    const plan = planOf([
      planEntry('madang-cli', [
        planOp('write', '/home/u/.agents/skills/madang-cli'),
        planOp('leave', '/home/u/.claude/skills/madang-cli', { reason })
      ])
    ])
    expect(resultLine(plan)).toBe(`Installed · Update skipped in Claude Code: ${text}`)
  })

  it('uses the same reason text for several skipped places', () => {
    const plan = planOf([
      planEntry('madang-cli', [
        planOp('write', '/home/u/.agents/skills/madang-cli'),
        planOp('leave', '/home/u/.claude/skills/madang-cli', { reason: 'edited' }),
        planOp('leave', '/home/u/.cursor/skills/madang-cli', {
          reason: 'edited',
          agents: ['cursor']
        })
      ])
    ])
    expect(resultLine(plan)).toBe(
      'Installed · Update skipped in 2 places: Skill edited outside Madang'
    )
  })

  it('keeps distinct reasons for several places', () => {
    const plan = planOf([
      planEntry('madang-cli', [
        planOp('write', '/home/u/.agents/skills/madang-cli'),
        planOp('leave', '/home/u/.claude/skills/madang-cli', { reason: 'edited' }),
        planOp('leave', '/home/u/.cursor/skills/madang-cli', {
          reason: 'other',
          agents: ['cursor']
        })
      ])
    ])
    expect(resultLine(plan)).toBe(
      'Installed · Update skipped in 2 places: Skill edited outside Madang; A different skill uses this name'
    )
  })

  it('reports the backup only when a replacement finished', () => {
    const plan = planOf([sharedEntry('madang-cli', 'replace')])
    const result = doneResult(plan)
    expect(resultLine(plan)).toBe('Replaced · Your copy was saved as a backup')
    result.skills[0].ops[0].status = 'failed'
    expect(skillInstallResultLine(result, bundledSkillSetupChanges(plan, result))).toBe(
      'Needs attention'
    )
  })

  it('keeps the install-for suffix after a replacement', () => {
    const plan = planOf([
      planEntry('madang-cli', [
        planOp('replace', '/home/u/.agents/skills/madang-cli'),
        planOp('link', '/home/u/.cursor/skills/madang-cli', { agents: ['cursor'] })
      ])
    ])
    expect(resultLine(plan)).toBe(
      'Replaced · Your copy was saved as a backup · Installed for Cursor'
    )
  })
})

describe('setup attention details', () => {
  it.each([
    ['unwritable', "Needs attention · Madang can't write to ~/.claude/skills"],
    ['busy', 'Needs attention · Another skill install is still finishing here'],
    ['unreadable', "Needs attention · Madang can't read every file in this copy"],
    ['edited', 'Needs attention · You edited this copy'],
    ['other', 'Needs attention · A different skill already uses this name'],
    ['shared-not-current', 'Needs attention · The shared copy this folder uses is not Madang’s'],
    [undefined, 'Needs attention']
  ] as const)('explains a %s blocker', (reason, message) => {
    const plan = planOf([
      planEntry('madang-cli', [planOp('leave', '/home/u/.claude/skills/madang-cli', { reason })])
    ])
    expect(bundledSkillSetupAttentionMessage(plan)).toBe(message)
  })

  it('uses the owning Windows host’s home formatter', () => {
    const plan = planOf([
      planEntry('madang-cli', [
        planOp('leave', 'C:\\Users\\Agent\\.claude\\skills\\madang-cli', { reason: 'unwritable' })
      ])
    ])
    plan.homeDirectory = 'c:\\users\\agent'
    expect(bundledSkillSetupAttentionMessage(plan)).toBe(
      "Needs attention · Madang can't write to ~\\.claude\\skills"
    )
  })

  it('keeps attention generic when there is no known blocker', () => {
    expect(bundledSkillSetupAttentionMessage(planOf([]))).toBe('Needs attention')
  })
})
