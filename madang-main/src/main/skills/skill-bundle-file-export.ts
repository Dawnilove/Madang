import { randomUUID } from 'node:crypto'
import type { SkillExportOutcome } from '../../shared/skill-share-import-contract'
import { createSkillBundleArchive, type CreatedSkillBundle } from './skill-bundle-creation'

/** Writes the chosen skill folders as one .tar.gz bundle in the same format Orca bundles use. */
export function exportSkillBundle(input: {
  skills: readonly { name: string; description?: string | null; directoryPath: string }[]
  bundleName: string
  archivePath: string
}): Promise<CreatedSkillBundle> {
  return createSkillBundleArchive({
    sources: input.skills.map((skill) => ({
      id: skill.name,
      sourceDirectory: skill.directoryPath
    })),
    archivePath: input.archivePath,
    packageId: randomUUID(),
    versionId: randomUUID(),
    bundleName: input.bundleName,
    description:
      input.skills.length === 1
        ? (input.skills[0].description ?? '')
        : `${input.skills.length} skills`
  })
}

export function skillExportErrorCode(
  error: unknown
): Extract<SkillExportOutcome, { status: 'error' }>['code'] {
  const message = error instanceof Error ? error.message : ''
  if (message === 'skill-bundle-skill-collision') {
    return 'duplicate-name'
  }
  return /size-limit/.test(message) ? 'too-large' : 'failed'
}
