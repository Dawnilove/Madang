import { randomUUID } from 'node:crypto'
import { MADANGD_NODE_RUNTIME_IDENTITY } from '../../../shared/madangd-node-runtime-identity'
import { MADANGD_NODE_RUNTIME_MARKER_FILENAME } from '../../../shared/madangd-artifacts'
import {
  MADANGD_PROFILE_PREFLIGHT_FLAG,
  MADANGD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseMadangdProfilePreflight
} from '../../../shared/madangd-profile-preflight'
import { assertPosixMadangdHost } from './madangd-remote-host-support'
import {
  madangdWindowsNodeCommandLine,
  madangdWindowsSlotOpCommand,
  readMadangdWindowsEncodedAnswer
} from './madangd-remote-windows-node'
import { readWindowsMadangdSlotEntry } from './madangd-remote-launch-windows'
import { MADANGD_WINDOWS_RUNTIME_MARKER } from '../host-state/madangd-windows-host-script'
import { madangdNodeSlotRuntimeCommand, selectMadangdSlotEntryCommand } from './madangd-remote-runtime'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import type { MadangdHostTransport } from '../../ssh/madangd-host-transport'

export function madangdProfilePreflightCommand(
  host: RemoteHostPlatform,
  directory: string,
  nonce: string
): string {
  assertPosixMadangdHost(host)
  // New candidates always use pinned Node; host Node fallback could mask an incomplete slot.
  const marker = quotePosixShell(
    joinRemotePath(host, directory, MADANGD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const launch = [
    'MADANG_BACKGROUND_LAUNCH=1',
    '"$madangd_runtime"',
    '"$madangd_entry"',
    MADANGD_PROFILE_PREFLIGHT_FLAG,
    quotePosixShell(nonce)
  ].join(' ')
  return `[ -e ${marker} ] || exit 78; ${madangdNodeSlotRuntimeCommand(host, directory)}${selectMadangdSlotEntryCommand(host, directory)}; ${launch}`
}

export async function preflightInstalledMadangd(options: {
  conn: MadangdHostTransport
  host: RemoteHostPlatform
  remoteInstallDir: string
  fullVersion: string
  signal?: AbortSignal
}): Promise<void> {
  const nonce = randomUUID()
  const command = isWindowsRemoteHost(options.host)
    ? await windowsMadangdProfilePreflightCommand(options, nonce)
    : madangdProfilePreflightCommand(options.host, options.remoteInstallDir, nonce)
  const output = await execCommand(options.conn, command, {
    signal: options.signal,
    timeoutMs: MADANGD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    wrapCommand: !isWindowsRemoteHost(options.host)
  })
  parseMadangdProfilePreflight(output, nonce, MADANGD_NODE_RUNTIME_IDENTITY, options.fullVersion)
}

// Windows uses plain argv; madangd opens no window and needs no background-launch environment.
async function windowsMadangdProfilePreflightCommand(
  options: {
    conn: MadangdHostTransport
    host: RemoteHostPlatform
    remoteInstallDir: string
    signal?: AbortSignal
  },
  nonce: string
): Promise<string> {
  const { host, remoteInstallDir } = options
  const slotAnswer = await execCommand(
    options.conn,
    madangdWindowsSlotOpCommand(host, remoteInstallDir, 'slot-runtime', [remoteInstallDir]),
    { signal: options.signal, wrapCommand: false }
  )
  const runtime = readMadangdWindowsEncodedAnswer(slotAnswer, MADANGD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this madangd slot needs.')
  }
  return madangdWindowsNodeCommandLine(runtime, [
    readWindowsMadangdSlotEntry(slotAnswer, host, remoteInstallDir),
    MADANGD_PROFILE_PREFLIGHT_FLAG,
    nonce
  ])
}
