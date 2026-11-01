import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type { PersistedTrustedOrcaHooks } from '../../../shared/madang-yaml-hook-types'
import { parseOrcaYaml } from '../../../shared/madang-yaml'
import { __resetTrustPromptChainForTests, ensureHooksConfirmed } from './ensure-hooks-confirmed'
import { hashOrcaHookScript } from './madang-hook-trust'
import { clearRuntimeCompatibilityCacheForTests } from '@/runtime/runtime-rpc-client'

// Trust is keyed by script content, not file name, so a legacy orca.yaml needs the same approval.
// The main process picks the file (see hooks-orca-compat-yaml.test.ts); here `yamlText` is the text it read.
let yamlText: string | null

function installHooksApi(): void {
  vi.stubGlobal('window', {
    api: {
      hooks: {
        check: vi.fn(async () => ({
          hasHooks: yamlText !== null,
          hooks: yamlText === null ? null : parseOrcaYaml(yamlText),
          mayNeedUpdate: false
        }))
      },
      runtimeEnvironments: { call: vi.fn() }
    }
  })
}

type Pending = { data: Record<string, unknown>; resolve: (d: 'run' | 'skip') => void }

function createState(trusted: PersistedTrustedOrcaHooks = {}): {
  state: AppState
  pending: Pending[]
} {
  const pending: Pending[] = []
  const state = {
    trustedOrcaHooks: trusted,
    repos: [{ id: 'repo-1', displayName: 'Repo One' }],
    openModal: (_modal: string, data: Record<string, unknown>) => {
      pending.push({ data, resolve: data.onResolve as (d: 'run' | 'skip') => void })
    }
  } as unknown as AppState
  return { state, pending }
}

const setupYaml = (script: string): string => `scripts:\n  setup: ${script}\n`

describe('ensureHooksConfirmed with legacy orca.yaml', () => {
  beforeEach(() => {
    yamlText = null
    clearRuntimeCompatibilityCacheForTests()
    installHooksApi()
    __resetTrustPromptChainForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks before running an untrusted setup script that only orca.yaml has', async () => {
    yamlText = setupYaml('echo old')
    const { state, pending } = createState()

    const decision = ensureHooksConfirmed(state, 'repo-1', 'setup')
    await vi.waitFor(() => expect(pending).toHaveLength(1))

    expect(pending[0].data.scriptContent).toBe('echo old')
    pending[0].resolve('skip')
    await expect(decision).resolves.toBe('skip')
  })

  it('treats madang.yaml and orca.yaml with the same script as one trust entry', async () => {
    yamlText = setupYaml('echo same')
    const { state, pending } = createState({
      'repo-1': { setup: { contentHash: await hashOrcaHookScript('echo same'), approvedAt: 1 } }
    })

    await expect(ensureHooksConfirmed(state, 'repo-1', 'setup')).resolves.toBe('run')
    expect(pending).toHaveLength(0)
  })

  it('asks again when orca.yaml content differs from the approved script', async () => {
    yamlText = setupYaml('echo changed')
    const { state, pending } = createState({
      'repo-1': { setup: { contentHash: await hashOrcaHookScript('echo approved'), approvedAt: 1 } }
    })

    const decision = ensureHooksConfirmed(state, 'repo-1', 'setup')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0].resolve('skip')
    await expect(decision).resolves.toBe('skip')
  })
})
