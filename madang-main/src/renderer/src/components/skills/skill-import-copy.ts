import { translate } from '@/i18n/i18n'
import type { SkillImportErrorCode } from '../../../../shared/skill-share-import-contract'

export type SkillImportMode = 'file' | 'github' | 'orca'

export function skillImportTitle(mode: SkillImportMode): string {
  if (mode === 'file') {
    return translate('madang.skillShare.import.fileTitle', 'Import skills from a file')
  }
  if (mode === 'github') {
    return translate('madang.skillShare.github.title', 'Install skills from a GitHub address')
  }
  return translate('madang.skillShare.orca.title', 'Import skills from an Orca share link')
}

export function skillImportErrorText(code: SkillImportErrorCode, mode: SkillImportMode): string {
  switch (code) {
    case 'file-invalid':
      return translate(
        'madang.skillShare.error.fileInvalid',
        'This file is not a valid skill bundle. Choose a .tar.gz bundle exported from Madang or Orca.'
      )
    case 'file-too-large':
    case 'too-large':
      return translate(
        'madang.skillShare.error.tooLarge',
        'The bundle is larger than the 40 MB limit.'
      )
    case 'invalid-url':
      return mode === 'orca'
        ? translate(
            'madang.skillShare.error.invalidOrcaLink',
            'This is not an Orca skill share link.'
          )
        : translate(
            'madang.skillShare.error.invalidGithub',
            'Enter an address like https://github.com/owner/repository.'
          )
    case 'not-found':
      return mode === 'orca'
        ? translate(
            'madang.skillShare.error.shareNotFound',
            'This share was not found. The link may be wrong, expired or revoked.'
          )
        : translate(
            'madang.skillShare.error.repoNotFound',
            'The repository or branch was not found. Private repositories cannot be read.'
          )
    case 'no-skills':
      return translate(
        'madang.skillShare.error.noSkills',
        'No skills were found. A skill is a folder that contains SKILL.md.'
      )
    case 'unsafe':
      return translate(
        'madang.skillShare.error.unsafe',
        'The download contains paths that are not safe, so Madang stopped.'
      )
    case 'unsupported-package':
      return translate(
        'madang.skillShare.error.unsupportedPackage',
        'This share uses an older single-skill format that Madang cannot import.'
      )
    case 'network':
      return translate(
        'madang.skillShare.error.network',
        'Could not download. Check your connection and try again.'
      )
    case 'failed':
      return translate('madang.skillShare.error.failed', 'Could not import the skills.')
  }
}
