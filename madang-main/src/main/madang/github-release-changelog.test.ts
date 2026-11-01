import { beforeEach, describe, expect, it, vi } from 'vitest'

const netMock = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net: netMock }))

import {
  changelogFromGitHubRelease,
  fetchGitHubReleaseChangelog,
  fetchGitHubReleaseNotes,
  releaseNotesFromGitHubRelease,
  summarizeReleaseBody
} from './github-release-changelog'

const RELEASE_PAGE = 'https://github.com/Dawnilove/Madang/releases/tag/v1.5.0'

describe('summarizeReleaseBody', () => {
  it('turns release markdown into one plain line', () => {
    expect(
      summarizeReleaseBody(
        '## Highlights\n\n- **Command palette** with `Ctrl+Shift+P`\n- See [docs](https://x.test)\n<!-- hidden -->\n![shot](a.png)'
      )
    ).toBe('Highlights Command palette with Ctrl+Shift+P See docs')
  })

  it('caps long bodies', () => {
    const summary = summarizeReleaseBody('word '.repeat(200))
    expect(summary.length).toBeLessThanOrEqual(280)
    expect(summary.endsWith('…')).toBe(true)
  })
})

describe('changelogFromGitHubRelease', () => {
  it('maps a GitHub release to the update card highlight', () => {
    expect(
      changelogFromGitHubRelease(
        {
          name: 'Madang 1.5.0',
          body: '- Recent workspaces on the start screen',
          html_url: RELEASE_PAGE
        },
        '1.5.0'
      )
    ).toEqual({
      release: {
        title: 'Madang 1.5.0',
        description: 'Recent workspaces on the start screen',
        releaseNotesUrl: RELEASE_PAGE
      },
      releasesBehind: null
    })
  })

  it('falls back to a version title and skips empty or foreign releases', () => {
    expect(
      changelogFromGitHubRelease({ name: '', body: 'Fixes', html_url: RELEASE_PAGE }, 'v1.5.0')
        ?.release.title
    ).toBe('Madang 1.5.0')
    expect(changelogFromGitHubRelease({ body: '   ', html_url: RELEASE_PAGE }, '1.5.0')).toBeNull()
    expect(
      changelogFromGitHubRelease(
        { body: 'Fixes', html_url: 'https://evil.test/releases/x' },
        '1.5.0'
      )
    ).toBeNull()
    expect(changelogFromGitHubRelease(null, '1.5.0')).toBeNull()
  })
})

describe('fetchGitHubReleaseChangelog', () => {
  beforeEach(() => {
    netMock.fetch.mockReset()
  })

  it('reads the release for the incoming tag from the Madang repo', async () => {
    netMock.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ name: 'Madang 1.5.0', body: 'New theme', html_url: RELEASE_PAGE })
      )
    )

    await expect(fetchGitHubReleaseChangelog('1.5.0')).resolves.toMatchObject({
      release: { description: 'New theme' }
    })
    expect(netMock.fetch.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/Dawnilove/Madang/releases/tags/v1.5.0'
    )
  })

  it('shows no highlight when the release is missing', async () => {
    netMock.fetch.mockResolvedValue(new Response('{}', { status: 404 }))

    await expect(fetchGitHubReleaseChangelog('1.5.0')).resolves.toBeNull()
  })
})

describe('releaseNotesFromGitHubRelease', () => {
  it('keeps the full body without shortening it', () => {
    const body = `## 새 기능

${'긴 줄 '.repeat(200)}`
    expect(
      releaseNotesFromGitHubRelease({ name: 'Madang 1.5.0', body, html_url: RELEASE_PAGE }, '1.5.0')
    ).toEqual({ title: 'Madang 1.5.0', body: body.trim(), url: RELEASE_PAGE })
  })

  it('returns null for an empty body, a foreign page or a bad shape', () => {
    expect(
      releaseNotesFromGitHubRelease({ body: '  ', html_url: RELEASE_PAGE }, '1.5.0')
    ).toBeNull()
    expect(
      releaseNotesFromGitHubRelease({ body: 'x', html_url: 'https://evil.test/a' }, '1.5.0')
    ).toBeNull()
    expect(releaseNotesFromGitHubRelease(null, '1.5.0')).toBeNull()
  })
})

describe('fetchGitHubReleaseNotes', () => {
  beforeEach(() => {
    netMock.fetch.mockReset()
  })

  it('reads the release of the given version', async () => {
    netMock.fetch.mockResolvedValue(
      new Response(JSON.stringify({ name: 'v1.5.0', body: 'Notes', html_url: RELEASE_PAGE }))
    )

    await expect(fetchGitHubReleaseNotes('1.5.0')).resolves.toEqual({
      title: 'v1.5.0',
      body: 'Notes',
      url: RELEASE_PAGE
    })
    expect(netMock.fetch.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/Dawnilove/Madang/releases/tags/v1.5.0'
    )
  })

  it('returns null on 404, network error and broken JSON', async () => {
    netMock.fetch.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    await expect(fetchGitHubReleaseNotes('1.5.0')).resolves.toBeNull()
    netMock.fetch.mockRejectedValueOnce(new Error('offline'))
    await expect(fetchGitHubReleaseNotes('1.5.0')).resolves.toBeNull()
    netMock.fetch.mockResolvedValueOnce(new Response('not json'))
    await expect(fetchGitHubReleaseNotes('1.5.0')).resolves.toBeNull()
  })
})
