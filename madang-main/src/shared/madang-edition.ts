// Set at build time (MADANG_EDITION=company in the build environment); every other build is the standard edition.
declare const MADANG_EDITION: string | undefined

/**
 * The company edition removes what a security review tends to object to: it never reads stored login tokens
 * for usage meters, never installs hooks into the agent CLIs' settings, and updates only from its own feed.
 */
export function isCompanyEdition(): boolean {
  return typeof MADANG_EDITION !== 'undefined' && MADANG_EDITION === 'company'
}

/** Fixed tag whose assets are replaced on each company release; the standard `latest` feed never carries them. */
export const COMPANY_UPDATE_FEED_URL =
  'https://github.com/Dawnilove/Madang/releases/download/company-latest'
