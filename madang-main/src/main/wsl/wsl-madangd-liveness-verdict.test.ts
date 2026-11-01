import { describe, expect, it } from 'vitest'
import {
  classifyWslMadangdLiveness,
  nextWslLivenessProbe,
  type WslLivenessEvidence
} from './wsl-madangd-liveness-verdict'

const INSTANCE = 'boot-a:100'
const MADANGD = '321:5000'

function evidence(overrides: Partial<WslLivenessEvidence> = {}): WslLivenessEvidence {
  return {
    trigger: { source: 'bridge', code: 1 },
    running: { status: 'confirmed', running: true },
    expected: { distroInstance: INSTANCE, madangd: MADANGD },
    ...overrides
  }
}

describe('classifyWslMadangdLiveness', () => {
  it('reads a failed running-list probe as unverifiable, never exited, whatever the exit code', () => {
    for (const code of [0, 1, null]) {
      const verdict = classifyWslMadangdLiveness(
        evidence({ trigger: { source: 'bridge', code }, running: { status: 'unavailable' } })
      )
      expect(verdict).toEqual({ kind: 'unverifiable', reason: 'running-list-unavailable' })
    }
  })

  it('marks every terminal exited when the distro is confirmed stopped', () => {
    const verdict = classifyWslMadangdLiveness(
      evidence({ running: { status: 'confirmed', running: false } })
    )
    expect(verdict).toEqual({ kind: 'distro-stopped', corroborated: true })
  })

  it('needs no exit code to prove a stop, but only a failed exit corroborates it', () => {
    const stopped = { status: 'confirmed', running: false } as const
    expect(
      classifyWslMadangdLiveness(evidence({ trigger: { source: 'verify' }, running: stopped }))
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
    expect(
      classifyWslMadangdLiveness(
        evidence({ trigger: { source: 'holder', code: 0 }, running: stopped })
      )
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
  })

  it('treats a running distro whose guest did not answer as unverifiable', () => {
    expect(classifyWslMadangdLiveness(evidence({ identity: null }))).toEqual({
      kind: 'unverifiable',
      reason: 'guest-unanswered'
    })
  })

  it('proves a restart from a new boot id or pid 1 start time, without any wall clock', () => {
    const verdict = classifyWslMadangdLiveness(
      evidence({ identity: { distroInstance: 'boot-a:900', madangd: null } })
    )
    expect(verdict).toEqual({ kind: 'distro-restarted' })
  })

  it('reads a gone or reused madangd pid in the same incarnation as madangd exited', () => {
    for (const madangd of [null, '321:7777']) {
      const verdict = classifyWslMadangdLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, madangd }
        })
      )
      expect(verdict).toEqual({ kind: 'madangd-exited' })
    }
  })

  it('keeps madangd live when the same process still runs, even after a bridge exit', () => {
    expect(
      classifyWslMadangdLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, madangd: MADANGD }
        })
      )
    ).toEqual({ kind: 'live' })
  })

  it('falls back to the port when no madangd pid was known', () => {
    const base = evidence({
      expected: { distroInstance: INSTANCE, madangd: null },
      identity: { distroInstance: INSTANCE, madangd: null }
    })
    expect(classifyWslMadangdLiveness({ ...base, madangdPort: 'ready' })).toEqual({ kind: 'live' })
    expect(classifyWslMadangdLiveness({ ...base, madangdPort: 'refused' })).toEqual({
      kind: 'madangd-exited'
    })
    expect(classifyWslMadangdLiveness({ ...base, madangdPort: 'unverifiable' })).toEqual({
      kind: 'unverifiable',
      reason: 'madangd-unanswered'
    })
  })
})

describe('nextWslLivenessProbe', () => {
  it('never probes inside a distro that is not confirmed running (an exec would boot it)', () => {
    expect(nextWslLivenessProbe(evidence({ running: { status: 'unavailable' } }))).toBeNull()
    expect(
      nextWslLivenessProbe(evidence({ running: { status: 'confirmed', running: false } }))
    ).toBeNull()
  })

  it('asks for identity first, and for the port only when no pid identity can decide', () => {
    expect(nextWslLivenessProbe(evidence())).toBe('identity')
    expect(
      nextWslLivenessProbe(evidence({ identity: { distroInstance: INSTANCE, madangd: MADANGD } }))
    ).toBeNull()
    const noPid = evidence({
      expected: { distroInstance: INSTANCE, madangd: null },
      identity: { distroInstance: INSTANCE, madangd: null }
    })
    expect(nextWslLivenessProbe(noPid)).toBe('madangd-port')
    expect(nextWslLivenessProbe({ ...noPid, madangdPort: 'refused' })).toBeNull()
    expect(
      nextWslLivenessProbe({ ...noPid, identity: { distroInstance: 'other', madangd: null } })
    ).toBeNull()
  })
})
