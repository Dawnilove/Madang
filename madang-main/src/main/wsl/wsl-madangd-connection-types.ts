import type { WslMadangdDeferredUpdate } from './wsl-madangd-deploy'

/** One open bridge to a distro's madangd, as the connection manager publishes it. */
export type WslMadangdConnection = {
  distro: string
  environmentId: string
  /** The loopback port on this machine the pairing offer points at. */
  localPort: number
  /** madangd's port inside the distro. */
  remotePort: number
  fullVersion: string
  /** madangd's pid inside the distro, from its pid file; null when unreadable. */
  pid: number | null
  /** madangd's pairing code, with its endpoint rewritten to `ws://127.0.0.1:<localPort>`. */
  pairingOffer: string
  /** An app update the incumbent `fullVersion` is waiting to take (live terminals). */
  deferredUpdate: WslMadangdDeferredUpdate | null
  close(): Promise<void>
}
