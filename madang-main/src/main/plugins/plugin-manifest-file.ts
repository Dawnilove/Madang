import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME,
  ORCA_COMPAT_PLUGIN_MARKETPLACE_FILENAME
} from '../../shared/plugins/orca-compat-plugin-files'
import { PLUGIN_MANIFEST_FILENAME } from '../../shared/plugins/plugin-manifest'
import { PLUGIN_MARKETPLACE_FILENAME } from '../../shared/plugins/plugin-marketplace'

// Bound startup/preview metadata reads independently of artifact payload sizes.
export const PLUGIN_MANIFEST_MAX_BYTES = 1024 * 1024

/** 새 이름이 먼저다. 새 이름이 없고 옛 Orca 이름이 있을 때만 옛 이름을 쓴다. */
function preferNewFilename(rootDir: string, current: string, legacy: string): string {
  if (existsSync(join(rootDir, current))) {
    return current
  }
  return existsSync(join(rootDir, legacy)) ? legacy : current
}

export function resolvePluginManifestFilename(rootDir: string): string {
  return preferNewFilename(rootDir, PLUGIN_MANIFEST_FILENAME, ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME)
}

export function resolvePluginMarketplaceFilename(rootDir: string): string {
  return preferNewFilename(
    rootDir,
    PLUGIN_MARKETPLACE_FILENAME,
    ORCA_COMPAT_PLUGIN_MARKETPLACE_FILENAME
  )
}

export async function readPluginManifestText(rootDir: string): Promise<string> {
  const filename = resolvePluginManifestFilename(rootDir)
  const chunks: Buffer[] = []
  let totalBytes = 0
  const stream = createReadStream(join(rootDir, filename))
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.byteLength
    if (totalBytes > PLUGIN_MANIFEST_MAX_BYTES) {
      throw new Error(`${filename} exceeds ${PLUGIN_MANIFEST_MAX_BYTES} bytes`)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8')
}
