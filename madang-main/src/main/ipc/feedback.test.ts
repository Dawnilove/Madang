import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, saveMock } = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  saveMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3-test' },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel))
  }
}))

vi.mock('../madang/local-feedback-report', () => ({
  saveLocalFeedbackReport: (...args: unknown[]) => saveMock(...args)
}))

import { registerFeedbackHandlers, submitFeedback } from './feedback'

describe('submitFeedback', () => {
  beforeEach(() => {
    handlers.clear()
    saveMock.mockReset()
    saveMock.mockResolvedValue({ ok: true })
  })

  it('strips GitHub identity when submitted anonymously', async () => {
    await submitFeedback({
      feedback: 'hello',
      submitAnonymously: true,
      githubLogin: 'octo',
      githubEmail: 'octo@example.com'
    })
    expect(saveMock.mock.calls[0]?.[0]).toMatchObject({
      feedback: 'hello',
      submissionType: 'feedback',
      githubLogin: null,
      githubEmail: null,
      appVersion: '1.2.3-test'
    })
  })

  it('keeps GitHub identity when not anonymous', async () => {
    await submitFeedback({
      feedback: 'hello',
      submitAnonymously: false,
      githubLogin: 'octo',
      githubEmail: 'octo@example.com'
    })
    expect(saveMock.mock.calls[0]?.[0]).toMatchObject({
      githubLogin: 'octo',
      githubEmail: 'octo@example.com'
    })
  })

  it('attaches diagnostic bundles only to crash reports', async () => {
    const diagnosticBundle = {
      bundleSubmissionId: 'bundleabcdefghijklmnop',
      content: '{"type":"bundle-header"}\n',
      bytes: 25,
      spanCount: 1
    }
    const base = { feedback: 'x', submitAnonymously: true, githubLogin: null, githubEmail: null }
    await submitFeedback({ ...base, submissionType: 'crash', diagnosticBundle })
    await submitFeedback({ ...base, submissionType: 'feedback', diagnosticBundle })
    expect(saveMock.mock.calls[0]?.[0]).toMatchObject({ diagnosticBundle })
    expect(saveMock.mock.calls[1]?.[0]).not.toHaveProperty('diagnosticBundle')
  })

  it('forces IPC submissions onto the feedback lane', async () => {
    registerFeedbackHandlers()
    const handler = handlers.get('feedback:submit')
    await handler?.(
      {},
      {
        feedback: 'x',
        submissionType: 'crash',
        submitAnonymously: true,
        githubLogin: null,
        githubEmail: null
      }
    )
    expect(saveMock.mock.calls[0]?.[0]).toMatchObject({ submissionType: 'feedback' })
  })
})
