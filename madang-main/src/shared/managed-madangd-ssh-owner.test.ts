import { describe, expect, it } from 'vitest'
import {
  getLegacyManagedMadangdOwnerEnvironmentId,
  getManagedMadangdFenceEnvironmentId,
  isEphemeralRuntimeSshOwner,
  managedMadangdServerName
} from './managed-madangd-ssh-owner'

describe('managed madangd SSH fence', () => {
  it('reads the fence from madangdFence, never from owner', () => {
    expect(getManagedMadangdFenceEnvironmentId({ madangdFence: { environmentId: 'env-1' } })).toBe(
      'env-1'
    )
    const legacyOnly = {
      madangdFence: undefined,
      owner: { type: 'on-demand-runtime' as const, runtimeId: 'managed-madangd:old' }
    }
    expect(getManagedMadangdFenceEnvironmentId({ ...legacyOnly })).toBeNull()
    expect(
      getManagedMadangdFenceEnvironmentId({ ...legacyOnly, madangdFence: { environmentId: 'env-2' } })
    ).toBe('env-2')
    expect(getManagedMadangdFenceEnvironmentId(undefined)).toBeNull()
  })

  it('recognises the legacy owner fence only so loading can migrate it', () => {
    const legacy = { type: 'on-demand-runtime' as const, runtimeId: 'managed-madangd:env-1' }
    expect(getLegacyManagedMadangdOwnerEnvironmentId(legacy)).toBe('env-1')
    expect(isEphemeralRuntimeSshOwner(legacy)).toBe(false)
  })

  it('keeps ordinary on-demand runtime targets ephemeral', () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-1' }
    expect(getLegacyManagedMadangdOwnerEnvironmentId(owner)).toBeNull()
    expect(isEphemeralRuntimeSshOwner(owner)).toBe(true)
  })

  it("names a recipe VM's server after its runtime, so two VMs of one recipe never collide", () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-0123456789abcdef' }
    expect(managedMadangdServerName({ label: 'Docker root', owner })).toBe('Docker root VM 89abcdef')
    expect(
      managedMadangdServerName({
        label: 'Docker root',
        owner: { ...owner, runtimeId: 'runtime-fedcba9876543210' }
      })
    ).toBe('Docker root VM 76543210')
    expect(managedMadangdServerName({ label: 'Builder' })).toBe('Builder')
  })
})
