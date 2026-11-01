import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  MADANGD_MOBILE_WEB_MANIFEST,
  MADANGD_SERVER_TARGET_FILENAME,
  MADANGD_VERSION,
  madangdArtifactFilenames,
  madangdMobileWebAssetFilenames
} from '../../shared/madangd-artifacts'
import { COMPAT_SERVER_TARGETS, SERVER_TARGETS } from '../../shared/node-runtime-pin'
import { madangdAgentBrowserNativeName } from '../../shared/madangd-agent-browser-name'

/** Hash installed bytes in the build's order; a version marker is not proof of delivery. */
export async function readMadangdArtifactIdentity(directory: string): Promise<string> {
  const target = z
    .enum([...SERVER_TARGETS, ...COMPAT_SERVER_TARGETS])
    .parse((await readFile(join(directory, MADANGD_SERVER_TARGET_FILENAME), 'utf8')).trim())
  const platform = target.startsWith('win32-')
    ? 'win32'
    : target.startsWith('darwin-')
      ? 'darwin'
      : 'linux'
  const browser = madangdAgentBrowserNativeName(
    platform,
    target.split('-')[1] ?? '',
    target.endsWith('-musl') ? 'musl' : 'glibc'
  )
  const filenames = madangdArtifactFilenames(
    target,
    madangdMobileWebAssetFilenames(await readFile(join(directory, MADANGD_MOBILE_WEB_MANIFEST), 'utf8'))
  )
  if (existsSync(join(directory, browser))) {
    filenames.push(browser)
  }
  const hash = createHash('sha256')
  for (const filename of filenames) {
    for await (const chunk of createReadStream(join(directory, filename))) {
      hash.update(chunk)
    }
  }
  return `${MADANGD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
