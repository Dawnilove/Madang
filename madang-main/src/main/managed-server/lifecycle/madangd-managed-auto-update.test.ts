import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyMadangdActivationRecord,
  type MadangdActivationRecord
} from '../activation/madangd-activation-record'
import { MadangdHostUnsupportedError } from '../../madangd/madangd-host-unavailable'

const mocks = vi.hoisted(() => {
  const state: { record: MadangdActivationRecord | null } = { record: null }
  return {
    state,
    materialize: vi.fn(async (_target: string) => '/cache/madangd'),
    runUpdate: vi.fn(),
    migrating: vi.fn((_userData: string, _environmentId: string): unknown => null)
  }
})

vi.mock('../../ssh/madangd-runtime-maintenance', () => ({
  withManagedMadangdLifecycle: (
    _userData: string,
    _selector: string,
    run: (managed: unknown) => Promise<unknown>
  ) => run({ environment: { id: 'env-1' }, deployment: {} }),
  runManagedMadangdUpdate: mocks.runUpdate
}))
vi.mock('./madangd-managed-runtime-context', () => ({
  resolveLinkedMadangdContext: async () => ({
    activationRecord: mocks.state.record,
    serverTarget: 'linux-x64'
  })
}))
vi.mock('./madangd-managed-migration-status', () => ({
  findIncompleteManagedMadangdMigration: mocks.migrating
}))
vi.mock('../../madangd/madangd-artifact-materializer', () => ({
  materializeMadangdArtifact: mocks.materialize
}))
vi.mock('../install/remote-versioned-install', () => ({
  readLocalFullVersion: () => '0.1.0+new'
}))

import {
  autoUpdateManagedMadangdEnvironment,
  resetBundledMadangdVersionsForTests
} from './madangd-managed-auto-update'
import { planManagedMadangdAutoUpdate } from './madangd-managed-update-decision'

function record(overrides: Partial<MadangdActivationRecord>): MadangdActivationRecord {
  return { ...emptyMadangdActivationRecord(), active: '0.1.0+old', ...overrides }
}

const plan = (r: MadangdActivationRecord, extra: { failedBefore?: boolean } = {}) =>
  planManagedMadangdAutoUpdate({
    record: r,
    candidateVersion: '0.1.0+new',
    appVersion: '1.5.0',
    failedBefore: extra.failedBefore ?? false
  })

describe('whether a connect updates its managed madangd', () => {
  it('skips a host already on this build', () => {
    expect(plan(record({ active: '0.1.0+new' }))).toEqual({ action: 'skip', reason: 'current' })
  })

  it('updates a host an older or pre-tracking Madang activated', () => {
    expect(plan(record({ activeAppVersion: '1.4.0' }))).toEqual({ action: 'update' })
    expect(plan(record({}))).toEqual({ action: 'update' })
  })

  it('never downgrades a host a newer Madang activated', () => {
    expect(plan(record({ activeAppVersion: '1.6.0' }))).toEqual({
      action: 'skip',
      reason: 'host-newer'
    })
  })

  it('leaves alone a build an explicit rollback moved away from', () => {
    expect(plan(record({ rolledBackFrom: '0.1.0+new' }))).toEqual({
      action: 'skip',
      reason: 'rolled-back'
    })
  })

  it('does not retry an update that already failed for this app version', () => {
    expect(plan(record({}), { failedBefore: true })).toEqual({
      action: 'skip',
      reason: 'failed-before'
    })
  })

  it('skips when the template carries no build for the host', () => {
    expect(
      planManagedMadangdAutoUpdate({
        record: record({}),
        candidateVersion: null,
        appVersion: '1.5.0',
        failedBefore: false
      })
    ).toEqual({ action: 'skip', reason: 'no-template' })
  })
})

describe('updating a managed madangd on connect', () => {
  const run = () =>
    autoUpdateManagedMadangdEnvironment('/user-data', {
      environmentId: 'env-1',
      appVersion: '1.5.0',
      failedBefore: () => false,
      onUpdating: vi.fn()
    })

  beforeEach(() => {
    resetBundledMadangdVersionsForTests()
    mocks.materialize.mockReset().mockResolvedValue('/cache/madangd')
    mocks.runUpdate.mockReset()
    mocks.migrating.mockReset().mockReturnValue(null)
    mocks.state.record = record({ activeAppVersion: '1.4.0' })
  })

  it('runs the Managed servers update, never forced past running terminals', async () => {
    mocks.runUpdate.mockResolvedValue({ outcome: 'updated', activeVersion: '0.1.0+new' })
    await expect(run()).resolves.toEqual({ outcome: 'updated', activeVersion: '0.1.0+new' })
    expect(mocks.runUpdate).toHaveBeenCalledWith(
      '/user-data',
      expect.anything(),
      expect.anything(),
      { admitRecord: expect.any(Function) }
    )
  })

  it.each([
    ['active', record({ active: '0.1.1+newer', activeAppVersion: '1.6.0' })],
    ['stopped', record({ active: null, previous: '0.1.1+newer', activeAppVersion: '1.6.0' })]
  ])(
    'skips when the record under the fence names a newer %s build than the one planned on',
    async (_name, lockedRecord) => {
      let admitted: string | null = 'not called'
      mocks.runUpdate.mockImplementation(async (_u, _m, _c, args) => {
        admitted = args.admitRecord(lockedRecord)
        return { outcome: 'deferred', code: 'madangd_activation_policy_refused', reason: 'x' }
      })
      await expect(run()).resolves.toEqual({ outcome: 'skipped', reason: 'host-newer' })
      expect(admitted).toEqual(expect.any(String))
    }
  )

  it('admits the record under the fence when it still allows this build', async () => {
    let admitted: string | null = 'not called'
    mocks.runUpdate.mockImplementation(async (_u, _m, _c, args) => {
      admitted = args.admitRecord(record({ activeAppVersion: '1.4.0' }))
      return { outcome: 'updated', activeVersion: '0.1.0+new' }
    })
    await expect(run()).resolves.toMatchObject({ outcome: 'updated' })
    expect(admitted).toBeNull()
  })

  it('reports live terminals as a wait, and a rejected candidate as a failure', async () => {
    mocks.runUpdate.mockResolvedValueOnce({
      outcome: 'deferred',
      code: 'madangd_update_terminals_running',
      reason: '1 terminal is running on this host.'
    })
    await expect(run()).resolves.toMatchObject({ outcome: 'deferred' })

    mocks.runUpdate.mockResolvedValueOnce({
      outcome: 'deferred',
      code: 'madangd_activation_fence_busy',
      reason: 'Another run is changing this host.'
    })
    await expect(run()).resolves.toMatchObject({ outcome: 'deferred' })

    mocks.runUpdate.mockResolvedValueOnce({
      outcome: 'deferred',
      code: 'madangd_candidate_launch_failed',
      reason: 'The candidate failed while starting. madangd 0.1.0+old was restarted.'
    })
    await expect(run()).resolves.toEqual({
      outcome: 'failed',
      reason: 'The candidate failed while starting. madangd 0.1.0+old was restarted.'
    })

    mocks.runUpdate.mockRejectedValueOnce(new Error('Could not snapshot state'))
    await expect(run()).resolves.toEqual({ outcome: 'failed', reason: 'Could not snapshot state' })
  })

  it('reads the bundled build once per session', async () => {
    mocks.state.record = record({ active: '0.1.0+new' })
    await run()
    await run()
    expect(mocks.materialize).toHaveBeenCalledTimes(1)
    expect(mocks.runUpdate).not.toHaveBeenCalled()
  })

  it('leaves a server alone while a migration into it is still running', async () => {
    mocks.migrating.mockReturnValue({ migrationId: 'm', phase: 'staged' })
    await expect(run()).resolves.toEqual({ outcome: 'skipped', reason: 'migrating' })
    expect(mocks.runUpdate).not.toHaveBeenCalled()
  })

  it('skips a host whose target the template does not carry', async () => {
    mocks.materialize.mockRejectedValue(new MadangdHostUnsupportedError('no linux-x64'))
    await expect(run()).resolves.toEqual({ outcome: 'skipped', reason: 'no-template' })
  })
})
