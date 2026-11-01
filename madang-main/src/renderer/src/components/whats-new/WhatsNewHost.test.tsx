// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WhatsNewHost } from './WhatsNewHost'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  updateSettings: vi.fn(async () => undefined),
  getVersion: vi.fn(),
  getReleaseNotes: vi.fn(),
  openUrl: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ ...mocks.state, updateSettings: mocks.updateSettings })
}))

// Stub Radix and the lazy markdown chunk: this test covers the host and dialog wiring only.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-dialog-open="true">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>
}))
vi.mock('@/components/sidebar/comment-markdown-lazy', () => ({
  CommentMarkdownAsync: ({
    content,
    onLinkClick
  }: {
    content: string
    onLinkClick: (event: { preventDefault: () => void }, href: string) => void
  }) => (
    <div data-testid="notes">
      {content}
      <button
        data-testid="link"
        onClick={(e) => onLinkClick(e, e.currentTarget.dataset.href ?? 'https://example.com/a')}
      />
      <button
        data-testid="bad-link"
        onClick={(e) => onLinkClick(e, 'file:///C:/Windows/system32/calc.exe')}
      />
    </div>
  )
}))

const notes = { title: 'Madang 1.1.0', body: '새 기능 목록', url: 'https://github.com/x/y/r' }
let host: HTMLDivElement
let root: Root

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<WhatsNewHost />)
  })
  await act(async () => {})
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.updateSettings.mockClear()
  mocks.getVersion.mockReset()
  mocks.getReleaseNotes.mockReset()
  mocks.openUrl.mockReset()
  mocks.state = { settings: { lastSeenWhatsNewVersion: '1.0.0' } }
  mocks.getVersion.mockResolvedValue('1.1.0')
  mocks.getReleaseNotes.mockResolvedValue(notes)
  vi.stubGlobal(
    'window',
    Object.assign(window, {
      api: {
        updater: { getVersion: mocks.getVersion, getReleaseNotes: mocks.getReleaseNotes },
        shell: { openUrl: mocks.openUrl }
      }
    })
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('WhatsNewHost', () => {
  it('shows the notes after an update and records the version only on close', async () => {
    await mount()

    expect(host.textContent).toContain('새 기능 목록')
    expect(host.textContent).toContain('1.1.0')
    expect(mocks.updateSettings).not.toHaveBeenCalled()

    const close = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Close')
    await act(async () => close?.click())

    expect(mocks.updateSettings).toHaveBeenCalledWith({ lastSeenWhatsNewVersion: '1.1.0' })
    expect(host.textContent).not.toContain('새 기능 목록')
  })

  it('opens http(s) links in the default browser and ignores other schemes', async () => {
    await mount()

    await act(async () => host.querySelector<HTMLElement>('[data-testid="link"]')?.click())
    await act(async () => host.querySelector<HTMLElement>('[data-testid="bad-link"]')?.click())

    expect(mocks.openUrl).toHaveBeenCalledTimes(1)
    expect(mocks.openUrl).toHaveBeenCalledWith('https://example.com/a')
  })

  it('first install: records the version and shows no dialog', async () => {
    mocks.state = { settings: {} }
    await mount()

    expect(host.textContent).toBe('')
    expect(mocks.updateSettings).toHaveBeenCalledWith({ lastSeenWhatsNewVersion: '1.1.0' })
  })

  it('offline: shows no dialog and records nothing', async () => {
    mocks.getReleaseNotes.mockResolvedValue(null)
    await mount()

    expect(host.textContent).toBe('')
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('waits until settings are loaded', async () => {
    mocks.state = { settings: null }
    await mount()

    expect(mocks.getVersion).not.toHaveBeenCalled()
  })
})
