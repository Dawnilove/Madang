import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BundledSkillOp, BundledSkillPlan } from '../../../shared/bundled-skill-plan'
import { planOf, sharedEntry } from '../components/skills/bundled-skill-plan-fixtures.test-support'
import type { DiscoveredSkill } from '../../../shared/skills'
import {
  getAgentSkillNavInstallStatus,
  getLinearAgentSkillNavInstallStatus
} from './agent-skill-nav-install-status'

function skill(name: string): DiscoveredSkill {
  const directoryPath = path.join('home', 'test', '.agents', 'skills', name)
  return {
    id: name,
    name,
    description: null,
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    rootPath: path.dirname(directoryPath),
    directoryPath,
    skillFilePath: path.join(directoryPath, 'SKILL.md'),
    installed: true,
    updatedAt: null
  }
}

function plan(...skills: [string, BundledSkillOp['kind']][]): BundledSkillPlan {
  return planOf(skills.map(([name, kind]) => sharedEntry(name, kind)))
}

describe('getAgentSkillNavInstallStatus', () => {
  it('keeps loading and missing states ahead of the plan', () => {
    expect(
      getAgentSkillNavInstallStatus({
        name: 'madang-linear',
        installed: true,
        loading: true,
        plan: plan(['madang-linear', 'keep'])
      })
    ).toBe('checking')
    expect(
      getAgentSkillNavInstallStatus({
        name: 'madang-linear',
        installed: false,
        loading: false,
        plan: null
      })
    ).toBe('install')
  })
})

describe('getLinearAgentSkillNavInstallStatus', () => {
  it('reports canonical installs under madang-linear', () => {
    const skills = [skill('madang-linear')]

    expect(
      getLinearAgentSkillNavInstallStatus({
        skills,
        installed: true,
        loading: false,
        plan: plan(['madang-linear', 'keep'])
      })
    ).toBe('up-to-date')
    expect(
      getLinearAgentSkillNavInstallStatus({
        skills,
        installed: true,
        loading: false,
        plan: plan(['madang-linear', 'update'])
      })
    ).toBe('update-available')
  })

  it('reports legacy-only installs under linear-tickets', () => {
    expect(
      getLinearAgentSkillNavInstallStatus({
        skills: [skill('linear-tickets')],
        installed: true,
        loading: false,
        plan: plan(['linear-tickets', 'keep'])
      })
    ).toBe('up-to-date')
  })

  it('prefers the plan for the canonical name when both names are installed', () => {
    expect(
      getLinearAgentSkillNavInstallStatus({
        skills: [skill('madang-linear'), skill('linear-tickets')],
        installed: true,
        loading: false,
        plan: plan(['madang-linear', 'keep'], ['linear-tickets', 'update'])
      })
    ).toBe('up-to-date')
  })

  it('falls back to presence-only status when no plan applies', () => {
    expect(
      getLinearAgentSkillNavInstallStatus({
        skills: [skill('madang-linear')],
        installed: true,
        loading: false,
        plan: null
      })
    ).toBe('installed')
  })
})
