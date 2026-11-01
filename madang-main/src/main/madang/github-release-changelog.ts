import { net } from 'electron'
import type { ChangelogData } from '../../shared/update-status-types'
import type { ReleaseNotes } from '../../shared/whats-new'
import {
  getReleaseRepoForChannel,
  getVersionChannel,
  MAIN_RELEASE_REPO,
  normalizeTagToVersion
} from '../../shared/release-channel'

const DESCRIPTION_MAX_CHARS = 280
const GITHUB_RELEASE_PAGE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\//

type GitHubRelease = {
  name?: unknown
  body?: unknown
  html_url?: unknown
}

/** Plain-text summary of a release body: the card shows text, not rendered markdown. */
export function summarizeReleaseBody(body: string): string {
  const lines = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .trim()
    )
    .filter((line) => line.length > 0)
  const text = lines.join(' ')
  return text.length > DESCRIPTION_MAX_CHARS
    ? `${text.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`
    : text
}

export function changelogFromGitHubRelease(json: unknown, version: string): ChangelogData | null {
  if (!json || typeof json !== 'object') {
    return null
  }
  const release = json as GitHubRelease
  const releaseNotesUrl = typeof release.html_url === 'string' ? release.html_url : ''
  if (!GITHUB_RELEASE_PAGE.test(releaseNotesUrl)) {
    return null
  }
  const description = typeof release.body === 'string' ? summarizeReleaseBody(release.body) : ''
  if (!description) {
    // Nothing to highlight; the plain update card already links to the release page.
    return null
  }
  const name = typeof release.name === 'string' ? release.name.trim() : ''
  return {
    release: {
      title: name || `Madang ${normalizeTagToVersion(version)}`,
      description,
      releaseNotesUrl
    },
    releasesBehind: null
  }
}

/** Madang: "What's new" comes from the GitHub release of the incoming version, not Orca's site. */
export async function fetchGitHubReleaseChangelog(
  incomingVersion: string
): Promise<ChangelogData | null> {
  const channel = getVersionChannel(incomingVersion)
  const repo = channel ? getReleaseRepoForChannel(channel) : MAIN_RELEASE_REPO
  const tag = `v${normalizeTagToVersion(incomingVersion)}`
  const res = await net.fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000)
    }
  )
  if (!res.ok) {
    return null
  }
  return changelogFromGitHubRelease(await res.json(), incomingVersion)
}

/** "새로운 점" 창용: 릴리스 본문 원문을 줄이지 않고 돌려준다. 본문이 비면 null. */
export function releaseNotesFromGitHubRelease(json: unknown, version: string): ReleaseNotes | null {
  if (!json || typeof json !== 'object') {
    return null
  }
  const release = json as GitHubRelease
  const url = typeof release.html_url === 'string' ? release.html_url : ''
  const body = typeof release.body === 'string' ? release.body.trim() : ''
  if (!GITHUB_RELEASE_PAGE.test(url) || !body) {
    return null
  }
  const name = typeof release.name === 'string' ? release.name.trim() : ''
  return { title: name || `Madang ${normalizeTagToVersion(version)}`, body, url }
}

/** 오프라인·404·오류는 모두 null (호출한 쪽은 조용히 건너뛴다). */
export async function fetchGitHubReleaseNotes(version: string): Promise<ReleaseNotes | null> {
  try {
    const channel = getVersionChannel(version)
    const repo = channel ? getReleaseRepoForChannel(channel) : MAIN_RELEASE_REPO
    const tag = `v${normalizeTagToVersion(version)}`
    const res = await net.fetch(
      `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(5000)
      }
    )
    return res.ok ? releaseNotesFromGitHubRelease(await res.json(), version) : null
  } catch {
    return null
  }
}
