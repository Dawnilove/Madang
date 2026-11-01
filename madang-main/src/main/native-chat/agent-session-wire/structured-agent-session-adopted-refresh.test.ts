import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  refreshAdoptedStructuredAgentSession,
  type AdoptedTranscriptRefreshContext
} from './structured-agent-session-adopted-refresh'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'

const THREAD = 'adopted-thread'
const SESSION = 'chat-1'
let root: string | null = null

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = null
})

async function writeRollout(text: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'madang-adopted-refresh-'))
  const path = join(root, 'rollout.jsonl')
  const lines = [
    { type: 'session_meta', payload: { id: THREAD, timestamp: '2026-09-06T18:00:00.000Z' } },
    {
      type: 'response_item',
      timestamp: '2026-09-06T18:00:01.000Z',
      payload: { type: 'message', role: 'user', content: text }
    }
  ]
  await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
  return path
}

function setup(options: { child?: { phase: string } | null; owes?: boolean } = {}) {
  const calls: string[] = []
  const replaceEpochItems = vi.fn(async () => {
    calls.push('replace')
    return { epoch: 'e2', sequence: 2 }
  })
  const session = {
    journal: { replaceEpochItems },
    child: options.child ?? null
  } as unknown as StructuredAgentSessionHostSession
  const stopAgent = vi.fn(async () => {
    calls.push('stop')
  })
  const context: AdoptedTranscriptRefreshContext = {
    store: {
      getRecord: () => ({ provider: 'codex', lease: { runtimeFence: 7 } }) as never
    },
    sessions: new Map([[SESSION, session]]),
    serialize: (_id, task) => task(),
    conversation: async () => session,
    owesWork: () => options.owes ?? false,
    stopAgent
  }
  return { context, replaceEpochItems, stopAgent, calls }
}

const source = (transcriptPath: string) => ({ providerSessionId: THREAD, transcriptPath })

describe('refreshAdoptedStructuredAgentSession', () => {
  it('stops the child, then replaces the journal with the transcript at the current fence', async () => {
    const path = await writeRollout('text added on the desktop')
    const { context, replaceEpochItems, calls } = setup({ child: { phase: 'ready' } })

    await expect(
      refreshAdoptedStructuredAgentSession(context, SESSION, source(path))
    ).resolves.toBe('refreshed')

    expect(calls).toEqual(['stop', 'replace'])
    const [reason, fence, items] = replaceEpochItems.mock.calls[0] as unknown as [
      string,
      number,
      unknown[]
    ]
    expect([reason, fence]).toEqual(['legacy_import', 7])
    expect(JSON.stringify(items)).toContain('text added on the desktop')
  })

  it('refreshes a chat without a child and stops nothing', async () => {
    const path = await writeRollout('hello')
    const { context, stopAgent } = setup()

    await expect(
      refreshAdoptedStructuredAgentSession(context, SESSION, source(path))
    ).resolves.toBe('refreshed')
    expect(stopAgent).not.toHaveBeenCalled()
  })

  it.each([
    ['owes work', { child: { phase: 'ready' }, owes: true }],
    ['starts its child', { child: { phase: 'starting' } }]
  ])('leaves a chat that %s untouched', async (_label, options) => {
    const path = await writeRollout('hello')
    const { context, stopAgent, replaceEpochItems } = setup(options)

    await expect(
      refreshAdoptedStructuredAgentSession(context, SESSION, source(path))
    ).resolves.toBe('busy')
    expect(stopAgent).not.toHaveBeenCalled()
    expect(replaceEpochItems).not.toHaveBeenCalled()
  })

  it('keeps the journal when the transcript cannot be read', async () => {
    const path = await writeRollout('hello')
    const { context, replaceEpochItems } = setup()

    await expect(
      refreshAdoptedStructuredAgentSession(context, SESSION, source(join(path, '..', 'missing')))
    ).resolves.toBe('unreadable')
    expect(replaceEpochItems).not.toHaveBeenCalled()
  })
})
