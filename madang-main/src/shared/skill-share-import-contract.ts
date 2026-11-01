import type { SkillCloudVersion } from './skill-cloud-contract'
import type { SkillBundleShareInstallInput } from './skill-sharing-contract'

/** The renderer turns each code into a localized sentence. */
export type SkillImportErrorCode =
  | 'file-invalid'
  | 'file-too-large'
  | 'invalid-url'
  | 'not-found'
  | 'no-skills'
  | 'too-large'
  | 'unsafe'
  | 'unsupported-package'
  | 'network'
  | 'failed'

export type SkillImportOutcome =
  | { status: 'ready'; importId: string; version: SkillCloudVersion; skippedCount: number }
  | { status: 'cancelled' }
  | { status: 'error'; code: SkillImportErrorCode }

export type SkillExportOutcome =
  | { status: 'saved'; path: string; skillCount: number }
  | { status: 'cancelled' }
  | { status: 'error'; code: 'duplicate-name' | 'too-large' | 'failed' }

export type SkillImportedBundleInstallInput = Omit<
  SkillBundleShareInstallInput,
  'shareId' | 'versionId'
> & { importId: string }
