import type { MadangdHostTransport } from './madangd-host-transport'
import type { SshConnection } from './connection/ssh-connection'

/** Return the connection object itself: tunnel ownership, dedupe and caches depend on its identity. */
export function sshMadangdHostTransport(connection: SshConnection): MadangdHostTransport {
  return connection
}
