import { z } from 'zod'
import {
  ORCA_COMPAT_SKILL_DOWNLOAD_ORIGINS,
  ORCA_COMPAT_SKILL_SHARE_API_ORIGIN
} from '../../shared/skills/orca-compat-skill-share'
import { parseSkillBundleManifest } from '../../shared/skill-bundle-manifest'
import { SKILL_PACKAGE_MAX_COMPRESSED_BYTES } from '../../shared/skill-package-manifest'
import { downloadSkillPackageGrant } from './skill-package-download'
import { inspectSkillBundleFile, type ImportedBundle } from './skill-bundle-file-import'
import { SkillImportError } from './skill-import-error'

const MAX_JSON_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/)
const ID = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)

const VersionSchema = z.object({
  packageId: ID,
  versionId: ID,
  archiveSha256: SHA256,
  compressedBytes: z.number().int().positive().max(SKILL_PACKAGE_MAX_COMPRESSED_BYTES),
  manifest: z.unknown()
})
const ShareResponseSchema = z.object({ share: z.object({ id: ID, version: VersionSchema }) })
const GrantResponseSchema = z.object({
  grant: z.object({ url: z.string().max(4096), expiresAt: z.string().max(64) }),
  version: VersionSchema
})

async function requestJson(
  path: string,
  fetcher: typeof fetch,
  body?: Record<string, string>
): Promise<unknown> {
  const url = new URL(path, ORCA_COMPAT_SKILL_SHARE_API_ORIGIN)
  if (url.origin !== ORCA_COMPAT_SKILL_SHARE_API_ORIGIN) {
    throw new SkillImportError('network')
  }
  let response: Response
  try {
    response = await fetcher(url, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
  } catch {
    throw new SkillImportError('network')
  }
  if (response.status === 404 || response.status === 410) {
    throw new SkillImportError('not-found')
  }
  const text = response.ok ? await response.text().catch(() => '') : ''
  if (!response.ok || text.length === 0 || text.length > MAX_JSON_BYTES) {
    throw new SkillImportError('network')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new SkillImportError('network')
  }
}

/**
 * Receive-only import of a skill bundle behind an Orca share link. Two unauthenticated requests to
 * the share API, then one download from the allow-listed storage origin. Call it only after the
 * user has confirmed the third-party warning.
 */
export async function importSkillsFromCompatShare(
  shareId: string,
  options: { temporaryRoot: string; fetcher?: typeof fetch }
): Promise<ImportedBundle> {
  const fetcher = options.fetcher ?? fetch
  const id = encodeURIComponent(shareId)
  const shareParsed = ShareResponseSchema.safeParse(
    await requestJson(`/v1/skill-shares/${id}`, fetcher)
  )
  if (!shareParsed.success || shareParsed.data.share.id !== shareId) {
    throw new SkillImportError('network')
  }
  const version = shareParsed.data.share.version
  let manifest
  try {
    manifest = parseSkillBundleManifest(version.manifest)
  } catch {
    // Older single-skill packages use another format that this import does not read.
    throw new SkillImportError('unsupported-package')
  }
  if (manifest.packageId !== version.packageId || manifest.versionId !== version.versionId) {
    throw new SkillImportError('network')
  }
  const grantParsed = GrantResponseSchema.safeParse(
    await requestJson(`/v1/skill-shares/${id}/download-grants`, fetcher, {
      versionId: version.versionId,
      installTarget: 'local'
    })
  )
  if (
    !grantParsed.success ||
    grantParsed.data.version.versionId !== version.versionId ||
    grantParsed.data.version.archiveSha256 !== version.archiveSha256
  ) {
    throw new SkillImportError('network')
  }
  let downloaded
  try {
    downloaded = await downloadSkillPackageGrant({
      url: grantParsed.data.grant.url,
      expiresAt: grantParsed.data.grant.expiresAt,
      expectedArchiveSha256: version.archiveSha256,
      expectedCompressedBytes: version.compressedBytes,
      temporaryRoot: options.temporaryRoot,
      allowedOrigins: ORCA_COMPAT_SKILL_DOWNLOAD_ORIGINS,
      requireHttps: true,
      fetcher
    })
  } catch {
    throw new SkillImportError('network')
  }
  try {
    // The review shows what the archive really holds, not what the share API claimed.
    const inspected = await inspectSkillBundleFile(downloaded.archivePath)
    return { ...inspected, cleanup: downloaded.cleanup }
  } catch (error) {
    await downloaded.cleanup()
    throw error
  }
}
