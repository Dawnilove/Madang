// Madang runs no skill share server. This file is the only place that names Orca's skill share
// service, and it is used only when the user pastes an Orca skill share link and confirms.
// Bundles behind such a link were made for Orca by a third party; Madang does not vouch for them.

/** Orca skill share API. Called only after the user confirms the pasted link. */
export const ORCA_COMPAT_SKILL_SHARE_API_ORIGIN = 'https://share.onorca.dev'

/** Origins a share download grant may point at. Anything else is refused, redirects included. */
export const ORCA_COMPAT_SKILL_DOWNLOAD_ORIGINS: readonly string[] = [
  'https://storage.googleapis.com'
]

const LINK_HOSTS: ReadonlySet<string> = new Set(['app.orca.dev', 'share.onorca.dev'])
const SHARE_PATH = /^\/?skills\/share\/([A-Za-z0-9_-]{1,128})\/?$/

/** Share id from an Orca skill share link, or null. A bare id is not accepted. */
export function parseOrcaCompatSkillShareLink(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol === 'orca:') {
    return (
      `${url.host}${url.pathname}`.match(/^skills\/share\/([A-Za-z0-9_-]{1,128})\/?$/)?.[1] ?? null
    )
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return null
  }
  return LINK_HOSTS.has(url.hostname) ? (url.pathname.match(SHARE_PATH)?.[1] ?? null) : null
}
