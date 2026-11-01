import type { ChangelogData } from '../shared/update-status-types'
import { fetchGitHubReleaseChangelog } from './madang/github-release-changelog'

// Madang: the incoming release's notes come from its GitHub release page.
export function fetchChangelog(
  incomingVersion: string,
  _localVersion: string
): Promise<ChangelogData | null> {
  return fetchGitHubReleaseChangelog(incomingVersion)
}
