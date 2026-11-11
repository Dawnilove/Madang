import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BundledSkillInstallResult,
  BundledSkillOp,
  BundledSkillPlan
} from '../../../shared/bundled-skill-plan'
import {
  ensureCollaborationSkill,
  migrateLegacyCliSkill,
  resetCollaborationSkillStateForTest,
  type BundledSkillApi
} from './collaboration-skill-install'

function op(kind: BundledSkillOp['kind'], extra: Partial<BundledSkillOp> = {}): BundledSkillOp {
  return {
    kind,
    path: '/home/u/.claude/skills/collaboration',
    role: 'agent',
    agents: ['claude'],
    observed: kind === 'keep' ? { kind: 'folder', entries: [], skillDigest: 'd' } : { kind: 'absent' },
    cleanup: [],
    ...extra
  }
}

function plan(ops: BundledSkillOp[], name = 'collaboration'): BundledSkillPlan {
  return {
    scope: 'global',
    homeDirectory: '/home/u',
    skills: [{ name, digest: 'd', ops }],
    planDigest: 'a'.repeat(64)
  }
}

const ran: BundledSkillInstallResult = {
  scope: 'global',
  skills: [{ name: 'collaboration', status: 'ran', ops: [] }]
}

function api(plans: BundledSkillPlan[], result: BundledSkillInstallResult | Error = ran): BundledSkillApi & {
  bundledExecute: ReturnType<typeof vi.fn>
} {
  const queue = [...plans]
  return {
    bundledPlan: vi.fn(async () => queue.shift() ?? plans.at(-1)!),
    bundledExecute: vi.fn(async () => {
      if (result instanceof Error) {
        throw result
      }
      return result
    })
  }
}

describe('ensureCollaborationSkill', () => {
  beforeEach(() => resetCollaborationSkillStateForTest())

  it('reports installed without writing when the stub is already current', async () => {
    const fake = api([plan([op('keep')])])
    expect(await ensureCollaborationSkill(fake)).toEqual({ kind: 'installed' })
    expect(fake.bundledExecute).not.toHaveBeenCalled()
  })

  it('installs a missing stub and confirms it from a fresh plan', async () => {
    const fake = api([plan([op('write')]), plan([op('keep')])])
    expect(await ensureCollaborationSkill(fake)).toEqual({ kind: 'installed' })
    expect(fake.bundledExecute).toHaveBeenCalledTimes(1)
  })

  it('keeps a visible failure with the reason when the folder cannot be written', async () => {
    const left = op('leave', { reason: 'unwritable' })
    const fake = api([plan([op('write')]), plan([left])], {
      scope: 'global',
      skills: [
        {
          name: 'collaboration',
          status: 'ran',
          ops: [{ path: left.path, kind: 'write', status: 'failed', error: 'EACCES' }]
        }
      ]
    })
    const state = await ensureCollaborationSkill(fake)
    expect(state).toEqual({ kind: 'failed', reason: `${left.path}: EACCES` })
  })

  it('turns a thrown install error into a failed state instead of rejecting', async () => {
    const fake = api([plan([op('write')])], new Error('ipc down'))
    expect(await ensureCollaborationSkill(fake)).toEqual({ kind: 'failed', reason: 'ipc down' })
  })
})

describe('migrateLegacyCliSkill', () => {
  it('installs madang-cli only when a legacy orca-cli copy is planned for backup', async () => {
    const withLegacy = api([
      plan(
        [
          op('write', {
            cleanup: [
              {
                path: '/home/u/.claude/skills/orca-cli',
                action: 'backup',
                observed: { kind: 'folder', entries: [], skillDigest: 'x' }
              }
            ]
          })
        ],
        'madang-cli'
      )
    ])
    expect(await migrateLegacyCliSkill(withLegacy)).toBe(true)
    expect(withLegacy.bundledExecute).toHaveBeenCalledTimes(1)

    const clean = api([plan([op('write')], 'madang-cli')])
    expect(await migrateLegacyCliSkill(clean)).toBe(false)
    expect(clean.bundledExecute).not.toHaveBeenCalled()
  })
})
