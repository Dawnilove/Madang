// Orca-era environment variable names (ORCA_*) stay readable and visible to child processes.
// Madang code reads and sets MADANG_* only; these two helpers bridge the old names at the edges.
// The file name starts with "orca-compat" so the rename tool leaves the Orca strings below alone.
const LEGACY_PREFIX = 'ORCA_'
const CURRENT_PREFIX = 'MADANG_'

/** Regex source that matches either prefix, for parsing files an older Orca-era install wrote. */
export const ENV_PREFIX_PATTERN = '(?:MADANG|ORCA)_'

/** Maps a MADANG_X name to its Orca-era ORCA_X twin. */
export function legacyEnvName(name: string): string {
  return name.startsWith(CURRENT_PREFIX) ? LEGACY_PREFIX + name.slice(CURRENT_PREFIX.length) : name
}

/**
 * Copies every ORCA_X in `env` to MADANG_X unless MADANG_X is already set, so a shell profile that
 * still exports the old names keeps working. Call it once, before anything reads the environment.
 */
export function applyLegacyEnvAliases(env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || !key.startsWith(LEGACY_PREFIX)) {
      continue
    }
    const current = CURRENT_PREFIX + key.slice(LEGACY_PREFIX.length)
    if (env[current] === undefined) {
      env[current] = value
    }
  }
}

/**
 * Returns a copy of a child's environment that carries every MADANG_X also as ORCA_X, so hook scripts
 * and agent skills written for the old names keep working. Old-name entries already in `env` are
 * dropped first: the MADANG_ side is the one the app sets and scrubs, so it is the only source.
 */
export function withLegacyEnvMirror<T extends Record<string, string | undefined>>(env: T): T {
  const result: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(LEGACY_PREFIX)) {
      result[key] = value
    }
  }
  for (const [key, value] of Object.entries(result)) {
    if (key.startsWith(CURRENT_PREFIX) && value !== undefined) {
      result[LEGACY_PREFIX + key.slice(CURRENT_PREFIX.length)] = value
    }
  }
  return result as T
}
