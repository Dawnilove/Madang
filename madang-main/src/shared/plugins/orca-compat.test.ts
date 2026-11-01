import { describe, expect, it } from 'vitest'
import { ORCA_COMPAT_MARKETPLACE_GIT_SOURCE, isOrcaCompatMarketplaceGitSource } from './orca-compat'

describe('isOrcaCompatMarketplaceGitSource', () => {
  it('matches the Orca plugin index in its common URL forms', () => {
    expect(isOrcaCompatMarketplaceGitSource(ORCA_COMPAT_MARKETPLACE_GIT_SOURCE.url)).toBe(true)
    expect(isOrcaCompatMarketplaceGitSource('https://github.com/stablyai/orca-plugins')).toBe(true)
    expect(isOrcaCompatMarketplaceGitSource('git@github.com:StablyAI/Orca-Plugins.git')).toBe(true)
  })

  it('rejects other repositories and hosts', () => {
    expect(isOrcaCompatMarketplaceGitSource('https://github.com/stablyai/other.git')).toBe(false)
    expect(
      isOrcaCompatMarketplaceGitSource('https://github.com/Dawnilove/madang-plugins.git')
    ).toBe(false)
    expect(isOrcaCompatMarketplaceGitSource('https://example.com/stablyai/orca-plugins.git')).toBe(
      false
    )
    expect(isOrcaCompatMarketplaceGitSource('not a url')).toBe(false)
  })
})
