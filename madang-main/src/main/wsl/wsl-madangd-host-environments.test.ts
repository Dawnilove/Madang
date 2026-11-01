import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import {
  observeWslMadangdHostResponse,
  registerWslMadangdHostEnvironment,
  unregisterWslMadangdHostEnvironment,
  wslMadangdHostSupports
} from './wsl-madangd-host-environments'

const CAPABILITY = 'agent-session.account-env.v1'

function status(capabilities: string[]): RuntimeRpcResponse<unknown> {
  return { id: 'status.get', ok: true, result: { capabilities }, _meta: { runtimeId: 'r' } }
}

describe('wslMadangdHostSupports', () => {
  afterEach(() => unregisterWslMadangdHostEnvironment('env-1', 'Ubuntu'))

  it('asks the host once, then answers from what it reported', async () => {
    registerWslMadangdHostEnvironment('env-1', 'Ubuntu')
    const readStatus = vi.fn(async () => status([CAPABILITY]))
    await expect(wslMadangdHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
    await expect(wslMadangdHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
    expect(readStatus).toHaveBeenCalledTimes(1)
  })

  it('reports an older host as unsupported and a failed probe as unknown', async () => {
    registerWslMadangdHostEnvironment('env-1', 'Ubuntu')
    await expect(wslMadangdHostSupports('env-1', CAPABILITY, async () => status([]))).resolves.toBe(
      'unsupported'
    )
    registerWslMadangdHostEnvironment('env-1', 'Ubuntu')
    await expect(
      wslMadangdHostSupports('env-1', CAPABILITY, async () => {
        throw new Error('offline')
      })
    ).resolves.toBe('unknown')
    const failure: RuntimeRpcResponse<unknown> = {
      id: 'status.get',
      ok: false,
      error: { code: 'x', message: 'x' }
    }
    await expect(wslMadangdHostSupports('env-1', CAPABILITY, async () => failure)).resolves.toBe(
      'unknown'
    )
  })

  it("follows a renderer's status.get and forgets it on reconnect", async () => {
    registerWslMadangdHostEnvironment('env-1', 'Ubuntu')
    observeWslMadangdHostResponse('env-1', 'status.get', status([]))
    const readStatus = vi.fn(async () => status([CAPABILITY]))
    await expect(wslMadangdHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('unsupported')
    observeWslMadangdHostResponse('env-1', 'terminal.list', status([CAPABILITY]))
    await expect(wslMadangdHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('unsupported')
    // A reconnect may be a redeployed madangd.
    registerWslMadangdHostEnvironment('env-1', 'Ubuntu')
    await expect(wslMadangdHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
  })

  it('records nothing for an environment that is not a WSL madangd', async () => {
    observeWslMadangdHostResponse('ssh-1', 'status.get', status([CAPABILITY]))
    await expect(wslMadangdHostSupports('ssh-1', CAPABILITY, async () => status([]))).resolves.toBe(
      'unknown'
    )
  })
})
