import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('./bundled-skill-guides.js', () => ({
  BUNDLED_SKILL_GUIDES: [
    {
      name: 'collaboration',
      description: 'Collaboration rules.',
      markdown: '# RULES\n',
      fullMarkdown: '# RULES\n',
      aliases: [],
      references: []
    },
    {
      name: 'other',
      description: 'Another topic.',
      markdown: '# OTHER\n',
      fullMarkdown: '# OTHER\n',
      aliases: [],
      references: []
    }
  ]
}))

const call = vi.fn()
const constructed = vi.fn()

vi.mock('./runtime-client', async () => {
  const { RuntimeClientError, RuntimeRpcFailureError } = await import('./runtime/types.js')
  class RuntimeClient {
    constructor() {
      constructed()
    }
    call = call
  }
  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError,
    serveOrcaApp: vi.fn(),
    getDefaultUserDataPath: vi.fn(() => '/tmp/orca-user-data')
  }
})

import { main } from './index'

function stdoutText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c) => String(c[0])).join('')
}

describe('madang skills get collaboration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    call.mockReset()
    constructed.mockReset()
    process.exitCode = undefined
  })

  it('serves the rules when the switch is on', async () => {
    call.mockResolvedValue({ result: { settings: { experimentalCollaboration: true } } })
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['skills', 'get', 'collaboration'], '/tmp/repo')

    expect(stdoutText(out)).toBe('# RULES\n')
  })

  it.each([
    ['the switch is off', () => call.mockResolvedValue({ result: { settings: {} } })],
    ['settings cannot be read', () => call.mockRejectedValue(new Error('no app'))]
  ])('says the rules are off when %s', async (_name, arrange) => {
    arrange()
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['skills', 'get', 'collaboration'], '/tmp/repo')

    expect(stdoutText(out)).toContain('협업 규칙: 꺼짐')
    expect(stdoutText(out)).not.toContain('# RULES')
  })

  it('does not touch the runtime for other topics', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['skills', 'get', 'other'], '/tmp/repo')

    expect(stdoutText(out)).toBe('# OTHER\n')
    expect(constructed).not.toHaveBeenCalled()
  })
})
