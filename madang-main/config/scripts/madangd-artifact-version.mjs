import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MADANGD_VERSION, madangdArtifactFilenames } from '../../src/shared/madangd-artifacts.ts'
import { readMadangdMobileWebAssetFilenames } from './madangd-mobile-web-bundle.mjs'

/** The runtime enters through `.runtime-node`'s executableSha256 string, never its bytes (design D2). */
export function computeMadangdFullVersion(artifactDir, { target, agentBrowserFilename }) {
  const hash = createHash('sha256')
  for (const filename of madangdArtifactFilenames(
    target,
    readMadangdMobileWebAssetFilenames(artifactDir)
  )) {
    const artifactPath = join(artifactDir, filename)
    if (!existsSync(artifactPath)) {
      throw new Error(
        `madangd declares ${filename} in MADANGD_ARTIFACTS but never emitted it. Add the build ` +
          'step, or drop it from src/shared/madangd-artifacts.ts.'
      )
    }
    hash.update(readFileSync(artifactPath))
  }
  if (agentBrowserFilename && existsSync(join(artifactDir, agentBrowserFilename))) {
    hash.update(readFileSync(join(artifactDir, agentBrowserFilename)))
  }
  return `${MADANGD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
