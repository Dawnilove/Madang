import { describe, expect, it } from 'vitest'
import {
  ORCA_COMPAT_SKILL_NAME_MAP,
  orcaCompatCurrentSkillName,
  orcaCompatLegacySkillNames
} from './orca-compat-skill-names'

describe('orca-compat-skill-names', () => {
  it('maps each legacy name to a madang- name', () => {
    for (const [legacy, current] of Object.entries(ORCA_COMPAT_SKILL_NAME_MAP)) {
      expect(legacy.startsWith('orca-')).toBe(true)
      expect(current).toBe(legacy.replace(/^orca-/u, 'madang-'))
    }
  })

  it('lists the legacy names of a current skill', () => {
    expect(orcaCompatLegacySkillNames('madang-cli')).toEqual(['orca-cli'])
    expect(orcaCompatLegacySkillNames('madang-emulator')).toEqual(['orca-emulator'])
    expect(orcaCompatLegacySkillNames('orchestration')).toEqual([])
  })

  it('turns a legacy name into the current name and keeps other names', () => {
    expect(orcaCompatCurrentSkillName('orca-per-workspace-env')).toBe('madang-per-workspace-env')
    expect(orcaCompatCurrentSkillName('madang-cli')).toBe('madang-cli')
    expect(orcaCompatCurrentSkillName('toString')).toBe('toString')
  })
})
