import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { MADANGD_SERVER_ENTRY_FILENAME } from '../../shared/madangd-artifacts'
import { assertMadangdServerRuntime, handoffToBundledMadangd } from './madangd-bundled-runtime'
import { MADANGD_EXIT_CONFIGURATION } from './madangd-configuration-exit'
import { enableManagedMadangdCompileCache } from './madangd-compile-cache'

declare const MADANGD_SERVER_SHA256: string

let loadServer: (() => void) | undefined

try {
  if (!handoffToBundledMadangd()) {
    assertMadangdServerRuntime()
    const entry = realpathSync(process.argv[1] ?? __filename)
    const server = join(dirname(entry), MADANGD_SERVER_ENTRY_FILENAME)
    if (createHash('sha256').update(readFileSync(server)).digest('hex') !== MADANGD_SERVER_SHA256) {
      throw new Error('The Madang server does not match its launcher')
    }
    loadServer = () => {
      enableManagedMadangdCompileCache(dirname(entry))
      createRequire(entry)(server)
    }
  }
} catch (error) {
  console.error('madangd: failed to launch:', error)
  process.exit(MADANGD_EXIT_CONFIGURATION)
}

loadServer?.()
