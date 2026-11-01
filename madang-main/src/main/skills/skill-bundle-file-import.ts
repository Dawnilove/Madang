import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillCloudVersion } from '../../shared/skill-cloud-contract'
import type { SkillBundleManifestV1 } from '../../shared/skill-bundle-manifest'
import { SKILL_PACKAGE_MAX_COMPRESSED_BYTES } from '../../shared/skill-package-manifest'
import { extractSkillBundleArchive } from './skill-bundle-extraction'
import { SkillImportError, skillImportErrorCode } from './skill-import-error'

/** A bundle on disk plus the facts the install review needs. */
export type ImportedBundle = {
  archivePath: string
  version: SkillCloudVersion
  cleanup(): Promise<void>
}

export function versionFromCreatedBundle(bundle: {
  manifest: SkillBundleManifestV1
  archiveSha256: string
  compressedBytes: number
}): SkillCloudVersion {
  const { manifest } = bundle
  return {
    packageId: manifest.packageId,
    versionId: manifest.versionId,
    name: manifest.bundleName,
    description: manifest.description,
    packageDigest: manifest.bundleDigest,
    archiveSha256: bundle.archiveSha256,
    compressedBytes: bundle.compressedBytes,
    createdAt: manifest.createdAt,
    releaseNotes: '',
    manifest
  }
}

/**
 * Checks a .tar.gz the user picked in the open dialog: size limit, then a full extraction into a
 * scratch folder that verifies the manifest, every file digest and every path. Nothing is installed.
 */
export async function inspectSkillBundleFile(archivePath: string): Promise<ImportedBundle> {
  const work = await mkdtemp(join(tmpdir(), 'madang-skill-inspect-'))
  try {
    const info = await stat(archivePath)
    if (!info.isFile()) {
      throw new SkillImportError('file-invalid')
    }
    if (info.size > SKILL_PACKAGE_MAX_COMPRESSED_BYTES) {
      throw new SkillImportError('file-too-large')
    }
    const extracted = await extractSkillBundleArchive({
      archivePath,
      destinationDirectory: join(work, 'verify')
    })
    return {
      archivePath,
      version: versionFromCreatedBundle(extracted),
      cleanup: async () => undefined
    }
  } catch (error) {
    const code = skillImportErrorCode(error)
    throw new SkillImportError(code === 'failed' ? 'file-invalid' : code)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
