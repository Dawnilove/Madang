import { cpSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  MADANGD_MOBILE_WEB_DIR,
  MADANGD_MOBILE_WEB_MANIFEST,
  madangdMobileWebAssetFilenames
} from '../../src/shared/madangd-artifacts.ts'

const { MOBILE_WEB_BUNDLE_DIR, assertMobileWebBundleBuilt } = createRequire(import.meta.url)(
  './verify-packaged-mobile-web-bundle.cjs'
)
const { assertNoDarkOutputOfOffSwitches } = createRequire(import.meta.url)(
  '../dark-build-switches.cjs'
)

// Require a fresh built page as beforePack does: an madangd package without it cannot serve phones.
export function stageMadangdMobileWebBundle(outputDir, bundleDir = MOBILE_WEB_BUNDLE_DIR) {
  // The release template refuses the variable itself.
  assertNoDarkOutputOfOffSwitches([bundleDir])
  assertMobileWebBundleBuilt(bundleDir)
  // The guard refuses unlisted files, so the tree is the manifest, its assets and a dark marker.
  cpSync(bundleDir, join(outputDir, ...MADANGD_MOBILE_WEB_DIR.split('/')), { recursive: true })
}

export function readMadangdMobileWebAssetFilenames(packageDir) {
  return madangdMobileWebAssetFilenames(
    readFileSync(join(packageDir, ...MADANGD_MOBILE_WEB_MANIFEST.split('/')), 'utf8')
  )
}
