import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import {
  resyncStructuredAgentSessionFromTranscript,
  type StructuredAgentSessionResyncHost
} from './structured-agent-session-resync'

const SESSION_ID = 'session-1111'
const NATIVE_ID = '11111111-2222-4333-8444-555555555555'

const record = {
  sessionId: SESSION_ID,
  location: { wslDistro: null },
  lease: { runtimeFence: 7 },
  providerHandleChain: [{ handle: { agent: 'claude', nativeId: NATIVE_ID } }]
} as unknown as AgentSessionRecord

const claudeLine = (role: 'user' | 'assistant', text: string, id: string) =>
  JSON.stringify({
    type: role,
    uuid: id,
    sessionId: NATIVE_ID,
    timestamp: '2026-10-30T00:00:00.000Z',
    message: { role, content: role === 'user' ? text : [{ type: 'text', text }] }
  })

describe('resyncStructuredAgentSessionFromTranscript', () => {
  let dir: string
  let filePath: string
  const replaceEpochItems = vi.fn(async () => ({}))
  let state = { hasChild: false, working: false }
  const stopIdleChild = vi.fn(async () => {
    state = { ...state, hasChild: false }
  })

  const host = (overrides: Partial<StructuredAgentSessionResyncHost> = {}) =>
    ({
      getRecord: () => record,
      openSession: async () => ({
        journal: { replaceEpochItems } as never,
        inspect: () => state
      }),
      stopIdleChild: stopIdleChild,
      serialize: (_id, task) => task(),
      resolveTranscript: async () => filePath,
      ...overrides
    }) satisfies StructuredAgentSessionResyncHost

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'resync-'))
    filePath = join(dir, `${NATIVE_ID}.jsonl`)
    state = { hasChild: false, working: false }
    replaceEpochItems.mockClear()
    stopIdleChild.mockClear()
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('replaces the history with the transcript when the chat is at rest', async () => {
    await writeFile(
      filePath,
      `${claudeLine('user', 'hello', 'u1')}\n${claudeLine('assistant', 'hi', 'a1')}\n`
    )
    const result = await resyncStructuredAgentSessionFromTranscript(host(), SESSION_ID)
    expect(result).toMatchObject({ ok: true })
    expect(replaceEpochItems).toHaveBeenCalledWith('legacy_import', 7, expect.any(Array))
  })

  it('refuses while the chat is working and leaves its child alone', async () => {
    state = { hasChild: true, working: true }
    await writeFile(
      filePath,
      `${claudeLine('user', 'hello', 'u1')}
`
    )
    const result = await resyncStructuredAgentSessionFromTranscript(host(), SESSION_ID)
    expect(result).toEqual({ ok: false, reason: 'busy' })
    expect(stopIdleChild).not.toHaveBeenCalled()
    expect(replaceEpochItems).not.toHaveBeenCalled()
  })

  it('stops an idle child before replacing the history', async () => {
    state = { hasChild: true, working: false }
    await writeFile(
      filePath,
      `${claudeLine('user', 'hello', 'u1')}
`
    )
    const result = await resyncStructuredAgentSessionFromTranscript(host(), SESSION_ID)
    expect(result).toMatchObject({ ok: true })
    expect(stopIdleChild).toHaveBeenCalledOnce()
    expect(replaceEpochItems).toHaveBeenCalledOnce()
  })

  it('refuses when the idle child does not stop', async () => {
    state = { hasChild: true, working: false }
    await writeFile(
      filePath,
      `${claudeLine('user', 'hello', 'u1')}
`
    )
    const result = await resyncStructuredAgentSessionFromTranscript(
      host({ stopIdleChild: async () => {} }),
      SESSION_ID
    )
    expect(result).toEqual({ ok: false, reason: 'busy' })
    expect(replaceEpochItems).not.toHaveBeenCalled()
  })

  it('reports a missing transcript without touching the history', async () => {
    const result = await resyncStructuredAgentSessionFromTranscript(
      host({ resolveTranscript: async () => null }),
      SESSION_ID
    )
    expect(result).toEqual({ ok: false, reason: 'transcript-missing' })
    expect(replaceEpochItems).not.toHaveBeenCalled()
  })

  it('never wipes the history with an empty transcript', async () => {
    await writeFile(filePath, '')
    const result = await resyncStructuredAgentSessionFromTranscript(host(), SESSION_ID)
    expect(result).toMatchObject({ ok: false })
    expect(replaceEpochItems).not.toHaveBeenCalled()
  })

  it('refuses an unknown session', async () => {
    const result = await resyncStructuredAgentSessionFromTranscript(
      host({ getRecord: () => undefined }),
      SESSION_ID
    )
    expect(result).toEqual({ ok: false, reason: 'no-session' })
  })
})
