import { parseGitRepositoryIdentity, type PluginMarketplaceGitSource } from './plugin-marketplace'

// Madang can browse Orca's plugin index, but only after the user adds it. These plugins were made
// for Orca by a third party; Madang does not vouch for them, so nothing here is marked official.
export const ORCA_COMPAT_MARKETPLACE_GIT_SOURCE: PluginMarketplaceGitSource = {
  kind: 'git',
  url: 'https://github.com/stablyai/orca-plugins.git',
  ref: 'main'
}

// Plugin `engines.orca` ranges name Orca versions. Madang restarted at 1.0.0, so app.getVersion()
// would reject every Orca plugin; check ranges against the Orca line Madang forked from instead.
export const ORCA_COMPAT_ENGINE_VERSION = '1.4.214'

// Fetched only while the Orca-compatible source is registered, so a revoked Orca plugin stays blocked.
export const ORCA_COMPAT_KILL_LIST_URL = 'https://onorca.dev/plugins/kill-list.json'

export function isOrcaCompatMarketplaceGitSource(url: string): boolean {
  const source = parseGitRepositoryIdentity(ORCA_COMPAT_MARKETPLACE_GIT_SOURCE.url)
  const candidate = parseGitRepositoryIdentity(url)
  return (
    source !== null &&
    candidate !== null &&
    candidate.host === source.host &&
    candidate.owner.toLowerCase() === source.owner.toLowerCase() &&
    candidate.repository.toLowerCase() === source.repository.toLowerCase()
  )
}
