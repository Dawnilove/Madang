// Lost channels drop their sockets but keep the listener; tunnel reconnect logic owns recovery.
import { MadangdStdioBridgeUnavailableError } from '../../madangd/madangd-host-unavailable'
import type { MadangdHostTransport } from '../../ssh/madangd-host-transport'
import {
  checkMadangdStdioBridge,
  openMadangdStdioBridgeChannel,
  resolveMadangdStdioBridge,
  type MadangdStdioBridge
} from '../../ssh/madangd-stdio-bridge'
import { listenMadangdStdioBridge } from './madangd-stdio-bridge-listener'
import { sshMadangdHostTransport } from '../../ssh/madangd-ssh-host-transport'
import type { RemoteCommandChannel } from '../install/remote-install-transport'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import type {
  PortForwardStartOptions,
  SshPortForwardProvider,
  StartedPortForward
} from '../../ssh/port-forwarding/ssh-port-forward-provider'

export type MadangdStdioBridgeDependencies = {
  resolveBridge: (conn: MadangdHostTransport, port: number) => Promise<MadangdStdioBridge>
  checkBridge: (conn: MadangdHostTransport, bridge: MadangdStdioBridge) => Promise<unknown>
  openChannel: (conn: MadangdHostTransport, bridge: MadangdStdioBridge) => Promise<RemoteCommandChannel>
}

export const MADANGD_STDIO_BRIDGE_DEPENDENCIES: MadangdStdioBridgeDependencies = {
  resolveBridge: resolveMadangdStdioBridge,
  checkBridge: checkMadangdStdioBridge,
  openChannel: openMadangdStdioBridgeChannel
}

export class MadangdStdioBridgePortForwardProvider implements SshPortForwardProvider {
  constructor(
    private readonly dependencies: MadangdStdioBridgeDependencies = MADANGD_STDIO_BRIDGE_DEPENDENCIES
  ) {}

  canHandle(conn: SshConnection): boolean {
    return conn.getClient() !== null || conn.usesSystemSshTransport()
  }

  start(conn: SshConnection, options: PortForwardStartOptions): Promise<StartedPortForward> {
    return startMadangdStdioBridge(sshMadangdHostTransport(conn), options, this.dependencies)
  }
}

export async function startMadangdStdioBridge(
  host: MadangdHostTransport,
  options: PortForwardStartOptions,
  deps: MadangdStdioBridgeDependencies
): Promise<StartedPortForward> {
  let bridge: Promise<MadangdStdioBridge> | null = null
  // Retry failed bridge resolution on the next socket.
  const resolveBridge = (): Promise<MadangdStdioBridge> => {
    bridge ??= deps.resolveBridge(host, options.remotePort).catch((error: unknown) => {
      bridge = null
      throw error
    })
    return bridge
  }
  try {
    await deps.checkBridge(host, await resolveBridge())
  } catch (error) {
    if (error instanceof MadangdStdioBridgeUnavailableError) {
      throw error
    }
    // Lost contact does not prove bridge absence; let new sockets resolve it again.
    console.warn('[ssh] Madang stdio bridge check was unverifiable:', error)
  }
  return listenMadangdStdioBridge(options, async () => {
    const resolved = await resolveBridge()
    return { channel: await deps.openChannel(host, resolved), mode: resolved.mode }
  })
}
