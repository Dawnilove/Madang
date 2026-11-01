import type { SshConnection } from './connection/ssh-connection'
import type { MadangdHostTransport } from './madangd-host-transport'

// Placeholders for tests that mock every reader of the connection, so it is only forwarded.

export function unusedSshConnection(): SshConnection {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: callers mock all code that would read the connection; it is only passed through.
  return {} as SshConnection
}

export function unusedMadangdHostTransport(): MadangdHostTransport {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: callers mock all code that would read the transport; it is only passed through.
  return {} as MadangdHostTransport
}
