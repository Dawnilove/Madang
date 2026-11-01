import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { MADANGD_LAUNCHER_FILENAME, MADANGD_SERVER_ENTRY_FILENAME } from './madangd-artifacts'

export const MADANGD_BUILD_HASH_LENGTH = 16

/** The launcher embeds its server digest, keeping the hash older clients calculate. */
export function hashMadangdLauncher(entryPath: string): string {
  const entry = realpathSync(entryPath)
  const launcher =
    basename(entry) === MADANGD_SERVER_ENTRY_FILENAME
      ? join(dirname(entry), MADANGD_LAUNCHER_FILENAME)
      : entry
  return createHash('sha256')
    .update(readFileSync(launcher))
    .digest('hex')
    .slice(0, MADANGD_BUILD_HASH_LENGTH)
}
