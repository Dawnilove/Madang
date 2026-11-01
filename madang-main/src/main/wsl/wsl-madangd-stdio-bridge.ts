/** D2: each accepted loopback socket owns a pinned-Node wsl.exe stdio bridge. Avoid WSL localhost forwarding, whose startup refusal window and network-mode dependence make it unreliable. */
import type { MadangdHostTransport } from '../ssh/madangd-host-transport'
import {
  MADANGD_STDIO_BRIDGE_DEPENDENCIES,
  startMadangdStdioBridge,
  type MadangdStdioBridgeDependencies
} from '../managed-server/lifecycle/madangd-stdio-bridge-provider'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'

export type WslMadangdStdioBridgeOptions = {
  environmentId: string
  /** madangd's loopback port inside the distro. */
  remotePort: number
  /** 0 picks a free one. */
  localPort: number
  label: string
}

export function listenWslMadangdStdioBridge(
  transport: MadangdHostTransport,
  options: WslMadangdStdioBridgeOptions,
  dependencies: MadangdStdioBridgeDependencies = MADANGD_STDIO_BRIDGE_DEPENDENCIES
): Promise<StartedPortForward> {
  return startMadangdStdioBridge(
    transport,
    {
      id: `wsl-madangd:${options.environmentId}`,
      connectionId: options.environmentId,
      localHost: '127.0.0.1',
      localPort: options.localPort,
      remoteHost: '127.0.0.1',
      remotePort: options.remotePort,
      label: options.label
    },
    dependencies
  )
}

type WslMadangdStdioBridgeListen = (
  transport: MadangdHostTransport,
  options: WslMadangdStdioBridgeOptions
) => Promise<StartedPortForward>

/** A persisted local port may be taken by now; a free one beats no connection. */
export async function listenWslMadangdStdioBridgeOnPreferredPort(
  transport: MadangdHostTransport,
  options: WslMadangdStdioBridgeOptions,
  listen: WslMadangdStdioBridgeListen = listenWslMadangdStdioBridge
): Promise<StartedPortForward> {
  try {
    return await listen(transport, options)
  } catch (error) {
    if (options.localPort === 0) {
      throw error
    }
    console.warn(
      `[wsl] Could not rebind local port ${options.localPort}; picking another:`,
      error instanceof Error ? error.message : error
    )
    return listen(transport, { ...options, localPort: 0 })
  }
}
