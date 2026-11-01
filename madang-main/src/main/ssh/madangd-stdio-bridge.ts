import {
  MadangdHostUnsupportedError,
  MadangdStdioBridgeUnavailableError
} from '../madangd/madangd-host-unavailable'
import { resolveMadangdRemoteContext } from '../managed-server/install/madangd-remote-context'
import { madangdWindowsHomeOpCommand } from '../managed-server/install/madangd-remote-windows-node'
import {
  madangdBashStdioBridgeCommand,
  madangdPosixStdioBridgeCommand,
  type MadangdStdioBridgeMode
} from '../managed-server/lifecycle/madangd-stdio-bridge-script'
import {
  MadangdStdioBridgeDecoder,
  type MadangdStdioBridgeSignal
} from '../managed-server/lifecycle/madangd-stdio-bridge-stream'
import { isWslMadangdHostTarget, type MadangdHostTransport } from './madangd-host-transport'
import type { RemoteCommandChannel } from '../managed-server/install/remote-install-transport'
import { isWindowsRemoteHost } from './ssh-remote-platform'
import { detectRemoteHostPlatform } from './ssh-remote-platform-detection'

export type MadangdStdioBridge = {
  command: string
  mode: MadangdStdioBridgeMode
  wrapCommand: boolean
}

const MADANGD_STDIO_BRIDGE_CHECK_TIMEOUT_MS = 20_000
const MAX_STDERR_TAIL_CHARS = 2_000
// POSIX shells and cmd.exe report a command they cannot find with these.
const COMMAND_NOT_FOUND_EXITS: ReadonlySet<number | null> = new Set([127, 9009])

export async function resolveMadangdStdioBridge(
  conn: MadangdHostTransport,
  port: number
): Promise<MadangdStdioBridge> {
  // WSL deploy already proved a POSIX Linux host; avoid redundant probing.
  if (isWslMadangdHostTarget(conn.getTarget())) {
    return { command: madangdBashStdioBridgeCommand(port), mode: 'raw', wrapCommand: true }
  }
  const host = await detectRemoteHostPlatform(conn)
  if (!host) {
    throw new MadangdHostUnsupportedError('Madang’s server doesn’t support this SSH host’s platform.')
  }
  if (!isWindowsRemoteHost(host)) {
    return { command: madangdPosixStdioBridgeCommand(port), mode: 'raw', wrapCommand: true }
  }
  const target = conn.getTarget()
  // Stage this client's pinned node.exe/script because app updates may change them.
  const context = await resolveMadangdRemoteContext(target, conn, undefined, host)
  return {
    command: madangdWindowsHomeOpCommand(host, context.remoteHome, 'stdio-bridge', [String(port)]),
    mode: 'base64',
    wrapCommand: host.commandDialect !== 'powershell'
  }
}

export function openMadangdStdioBridgeChannel(
  conn: MadangdHostTransport,
  bridge: MadangdStdioBridge
): Promise<RemoteCommandChannel> {
  return conn.exec(bridge.command, { wrapCommand: bridge.wrapCommand })
}

function closeQuietly(channel: RemoteCommandChannel): void {
  try {
    channel.close()
  } catch {}
}

/** Any sentinel proves the bridge executable, even if madangd refuses connection. Only reported command-not-found proves permanent unsupported status; other failures stay unverifiable. */
export async function checkMadangdStdioBridge(
  conn: MadangdHostTransport,
  bridge: MadangdStdioBridge,
  timeoutMs = MADANGD_STDIO_BRIDGE_CHECK_TIMEOUT_MS
): Promise<'running' | 'unverifiable'> {
  let channel: RemoteCommandChannel
  try {
    channel = await openMadangdStdioBridgeChannel(conn, bridge)
  } catch {
    return 'unverifiable'
  }
  const decoder = new MadangdStdioBridgeDecoder(bridge.mode)
  let stderr = ''
  let exitCode: number | null = null
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => settle('unverifiable'), timeoutMs)
    function settle(verdict: 'running' | 'unverifiable' | Error): void {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      closeQuietly(channel)
      decoder.destroy()
      if (verdict instanceof Error) {
        reject(verdict)
      } else {
        resolve(verdict)
      }
    }
    const unavailable = (detail: string): Error =>
      new MadangdStdioBridgeUnavailableError(
        `The SSH host could not run the stdio bridge for this host’s Madang server: ${detail}`
      )
    decoder.on('signal', (signal: MadangdStdioBridgeSignal) => {
      settle(signal === 'no-node' ? unavailable('no pinned Node runtime') : 'running')
    })
    decoder.on('error', () => settle('unverifiable'))
    decoder.resume()
    channel.pipe(decoder)
    channel.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_TAIL_CHARS)
    })
    channel.on('exit', (code: unknown) => {
      exitCode = typeof code === 'number' ? code : null
    })
    channel.on('close', () => {
      // Only command-not-found is permanent; lost channels or interrupted script/runtime execution prove nothing.
      settle(
        COMMAND_NOT_FOUND_EXITS.has(exitCode)
          ? unavailable(`exit ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
          : 'unverifiable'
      )
    })
    channel.on('error', () => settle('unverifiable'))
  })
}
