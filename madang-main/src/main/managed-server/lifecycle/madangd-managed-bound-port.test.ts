import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

const execMadangdRemote = vi.hoisted(() => vi.fn())
vi.mock('../install/madangd-remote-runtime-control', () => ({ execMadangdRemote }))
const resolveMadangdRemoteContext = vi.hoisted(() => vi.fn())
vi.mock('../install/madangd-remote-context', () => ({ resolveMadangdRemoteContext }))

import { madangdBoundPort, resolveManagedMadangdTunnelPort } from './madangd-managed-bound-port'
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import { unusedMadangdHostTransport } from '../../ssh/unused-host-transport.test-fixture'

function readinessLine(boundEndpoint: string | null): string {
  return `${JSON.stringify({ type: 'orca_server_ready', runtimeId: 'runtime-1', boundEndpoint })}\n`
}

describe('madangdBoundPort', () => {
  it('reads the port madangd actually bound', () => {
    expect(madangdBoundPort({ boundEndpoint: 'ws://127.0.0.1:58520' })).toBe(58_520)
  })

  it.each([null, 'not a url', 'ws://127.0.0.1'])('returns null for %s', (boundEndpoint) => {
    expect(madangdBoundPort({ boundEndpoint })).toBeNull()
  })
})

describe('resolveManagedMadangdTunnelPort', () => {
  const link = {
    sshTargetId: 'ssh-1',
    sshTargetGeneration: 1,
    localPort: 46_768,
    remotePort: 6_768
  }
  function input(kind: 'madangdDeployment' | 'sshAccess') {
    return {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only the link fields.
      environment: { [kind]: link } as unknown as KnownRuntimeEnvironment,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: passed through to the mocked context.
      target: { id: 'ssh-1' } as SshTarget,
      connection: unusedMadangdHostTransport()
    }
  }

  beforeEach(() => {
    execMadangdRemote.mockReset()
    resolveMadangdRemoteContext.mockReset()
  })

  it('reads the active slot of a managed server', async () => {
    resolveMadangdRemoteContext.mockResolvedValue({
      activationRecord: { active: '1.0.0+abc' },
      connection: {},
      host: getRemoteHostPlatform('linux-x64'),
      remoteHome: '/home/deploy'
    })
    execMadangdRemote.mockResolvedValue(readinessLine('ws://127.0.0.1:58520'))
    await expect(resolveManagedMadangdTunnelPort(input('madangdDeployment'))).resolves.toBe(58_520)
  })

  it.each([
    ['no readiness file', ''],
    ['a readiness without an endpoint', readinessLine(null)]
  ])('falls back to the preferred port for %s (older builds)', async (_label, output) => {
    resolveMadangdRemoteContext.mockResolvedValue({
      activationRecord: { active: '1.0.0+abc' },
      connection: {},
      host: getRemoteHostPlatform('linux-x64'),
      remoteHome: '/home/deploy'
    })
    execMadangdRemote.mockResolvedValue(output)
    await expect(resolveManagedMadangdTunnelPort(input('madangdDeployment'))).resolves.toBe(6_768)
  })

  it('keeps the configured port for independent SSH access without touching the host', async () => {
    await expect(resolveManagedMadangdTunnelPort(input('sshAccess'))).resolves.toBe(6_768)
    expect(resolveMadangdRemoteContext).not.toHaveBeenCalled()
  })

  it('tries the preferred port when the host cannot be read; the identity check still guards it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    resolveMadangdRemoteContext.mockRejectedValue(new Error('platform probe failed'))
    await expect(resolveManagedMadangdTunnelPort(input('madangdDeployment'))).resolves.toBe(6_768)
    warn.mockRestore()
  })
})
