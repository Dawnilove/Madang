import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackSubmitBody } from '../ipc/feedback-request'

const state = vi.hoisted(() => ({ root: '', userData: '' }))
const shellMock = vi.hoisted(() => ({
  openExternal: vi.fn(async (_url: string) => {}),
  showItemInFolder: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  shell: shellMock
}))

import { buildNewIssueUrl, saveLocalFeedbackReport } from './local-feedback-report'

const NOW = new Date('2026-10-26T12:34:56.789Z')

function makeBody(overrides: Partial<FeedbackSubmitBody> = {}): FeedbackSubmitBody {
  return {
    feedback: 'Sidebar flickers when I switch projects.',
    submissionType: 'feedback',
    githubLogin: null,
    githubEmail: null,
    appVersion: '1.4.214',
    platform: 'linux',
    osRelease: '6.8.0',
    arch: 'x64',
    ...overrides
  }
}

function issueParams(): URLSearchParams {
  const url = String(shellMock.openExternal.mock.calls[0]?.[0])
  expect(url.startsWith('https://github.com/Dawnilove/Madang/issues/new?')).toBe(true)
  return new URL(url).searchParams
}

describe('saveLocalFeedbackReport', () => {
  beforeEach(() => {
    state.root = mkdtempSync(join(tmpdir(), 'madang-feedback-'))
    state.userData = state.root
    shellMock.openExternal.mockClear()
    shellMock.showItemInFolder.mockClear()
  })

  afterEach(() => {
    rmSync(state.root, { recursive: true, force: true })
  })

  it('saves a text report and opens a prefilled issue without revealing a folder', async () => {
    const result = await saveLocalFeedbackReport(
      makeBody({
        feedback:
          'Sidebar flickers when I switch projects.\n\n---\nMadang: 1.4.214\nOS: linux 6.8.0 (x64)'
      }),
      NOW
    )

    expect(result).toEqual({ ok: true, savedLocally: true })
    const folder = join(state.userData, 'feedback-reports', '2026-10-26T12-34-56-789Z-feedback')
    const report = readFileSync(join(folder, 'report.md'), 'utf8')
    expect(report).toContain('Sidebar flickers when I switch projects.')
    // The dialog's prefilled footer is replaced by one environment block.
    expect(report.match(/Madang: 1\.4\.214/g)).toHaveLength(1)

    const params = issueParams()
    expect(params.get('title')).toBe('[피드백] Sidebar flickers when I switch projects.')
    expect(params.get('body')).toContain('- OS: linux 6.8.0 (x64)')
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('writes images and diagnostic logs beside the report and keeps them out of the URL', async () => {
    await saveLocalFeedbackReport(
      makeBody({
        submissionType: 'crash',
        feedback: 'Renderer crashed after opening a large diff.',
        images: [{ contentType: 'image/png', data: new Uint8Array([1, 2, 3]) }],
        diagnosticBundle: {
          bundleSubmissionId: 'bundle-1',
          content: 'secret-log-line',
          bytes: 15,
          spanCount: 1
        }
      }),
      NOW
    )

    const folder = join(state.userData, 'feedback-reports', '2026-10-26T12-34-56-789Z-crash')
    expect(readdirSync(folder).sort()).toEqual(['diagnostic-logs.txt', 'image-1.png', 'report.md'])
    expect(readFileSync(join(folder, 'diagnostic-logs.txt'), 'utf8')).toBe('secret-log-line')

    const params = issueParams()
    expect(params.get('title')).toBe('[충돌 보고] Madang 1.4.214')
    expect(params.get('body')).not.toContain('secret-log-line')
    expect(params.get('body')).not.toContain(state.userData)
    expect(shellMock.showItemInFolder).toHaveBeenCalledWith(join(folder, 'report.md'))
  })

  it('reports a write failure instead of claiming success', async () => {
    // A file where the profile folder should be makes every write fail.
    state.userData = join(state.root, 'not-a-folder')
    writeFileSync(state.userData, '')

    const result = await saveLocalFeedbackReport(makeBody(), NOW)

    expect(result.ok).toBe(false)
    expect(shellMock.openExternal).not.toHaveBeenCalled()
  })
})

describe('buildNewIssueUrl', () => {
  it('clips long text so the URL stays within GitHub limits', () => {
    const url = buildNewIssueUrl(makeBody({ feedback: 'x'.repeat(20_000) }), false)
    const body = new URL(url).searchParams.get('body') ?? ''

    expect(body.length).toBeLessThan(7_000)
    expect(body).toContain('전체 내용은 저장된 보고서 파일에 있습니다')
  })
})
