import type { SkillImportErrorCode } from '../../shared/skill-share-import-contract'

export class SkillImportError extends Error {
  constructor(readonly code: SkillImportErrorCode) {
    super(`skill-import-${code}`)
  }
}

/** Maps any thrown value to a code the renderer can show; the cause stays in the main log. */
export function skillImportErrorCode(error: unknown): SkillImportErrorCode {
  if (error instanceof SkillImportError) {
    return error.code
  }
  const message = error instanceof Error ? error.message : ''
  if (/size-limit/.test(message)) {
    return 'too-large'
  }
  return 'failed'
}
