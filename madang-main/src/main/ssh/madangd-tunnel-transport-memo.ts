export type MadangdTunnelTransport = 'tcp_forward' | 'stdio_bridge'

const transports = new Map<string, MadangdTunnelTransport>()

export function rememberMadangdTunnelTransport(
  targetId: string,
  transport: MadangdTunnelTransport
): void {
  transports.set(targetId, transport)
}

export function knownMadangdTunnelTransport(targetId: string): MadangdTunnelTransport | null {
  return transports.get(targetId) ?? null
}
