export type GithubSkillSource = {
  owner: string
  repo: string
  /** Branch, tag or commit from a `/tree/<ref>` address; null means the default branch. */
  ref: string | null
  /** Folder inside the repository without slashes at the ends; empty means the whole repository. */
  path: string
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const REF = /^[A-Za-z0-9._-]{1,100}$/

function validPathSegment(segment: string): boolean {
  return (
    segment !== '.' &&
    segment !== '..' &&
    segment.length <= 255 &&
    !/[\\%:*?"<>|]/.test(segment) &&
    ![...segment].some((character) => character.charCodeAt(0) <= 0x1f)
  )
}

/**
 * Reads `https://github.com/<owner>/<repo>` or `.../tree/<ref>/<path>`.
 * A branch name that contains `/` is not supported: the first segment after `tree` is the ref.
 */
export function parseGithubSkillUrl(value: string): GithubSkillSource | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const owner = segments[0]
  const repo = segments[1]?.replace(/\.git$/, '')
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    return null
  }
  if (segments.length === 2) {
    return { owner, repo, ref: null, path: '' }
  }
  const ref = segments[3]
  const path = segments.slice(4)
  if (segments[2] !== 'tree' || !ref || !REF.test(ref) || !path.every(validPathSegment)) {
    return null
  }
  return { owner, repo, ref, path: path.join('/') }
}
