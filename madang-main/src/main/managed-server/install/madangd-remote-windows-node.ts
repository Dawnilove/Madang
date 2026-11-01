// SSH DefaultShell may be cmd.exe or PowerShell; commands must parse identically in both.
import { currentMadangdFence } from '../activation/madangd-activation-fence-scope'
import { MADANGD_WINDOWS_FENCE_ARG } from '../host-state/madangd-windows-host-fence-ops'
import {
  MADANGD_NODE_RUNTIME_DIR_PREFIX,
  MADANGD_NODE_RUNTIME_WINDOWS_EXECUTABLE,
  MADANGD_RUNTIMES_DIRNAME
} from '../../../shared/madangd-artifacts'
import { pinnedNodeRuntimeAsset, type NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { randomUUID } from 'node:crypto'
import type { MadangdHostTransport } from '../../ssh/madangd-host-transport'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import {
  joinRemotePath,
  remoteDirname,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { quotePowerShellLiteral as powerShellLiteral } from '../../../shared/powershell-native-argument'
import { MADANGD_WINDOWS_COMMAND_LINE_UNSAFE_CODE } from '../../madangd/madangd-host-unavailable'
import {
  MADANGD_WINDOWS_HOST_SCRIPT,
  MADANGD_WINDOWS_HOST_SCRIPT_FILENAME,
  MADANGD_WINDOWS_HOST_SCRIPT_PRESENT,
  type MadangdWindowsHostOp
} from '../host-state/madangd-windows-host-script'

const BARE_EXECUTABLE = /^[A-Za-z]:\\[A-Za-z0-9._+~\\-]*$/u
// Leading digits are quoted: PowerShell would read `1e5` as a number and pass `100000`.
const BARE_ARGUMENT = /^[A-Za-z-][A-Za-z0-9._:+=/\\-]*$/u
// cmd.exe expands %; PowerShell expands $, backticks and typographic quotes inside double quotes.
const UNQUOTABLE = /["%$`\r\n\u201C\u201D\u201E\u2018\u2019\u201A\u201B]/u

export class MadangdWindowsCommandLineError extends Error {
  readonly code = MADANGD_WINDOWS_COMMAND_LINE_UNSAFE_CODE
  constructor(value: string) {
    super(
      `Madang cannot pass ${JSON.stringify(value)} to node.exe on this Windows host: it contains ` +
        'a character cmd.exe or PowerShell would expand.'
    )
    this.name = 'MadangdWindowsCommandLineError'
  }
}

function windowsPath(value: string): string {
  return value.replace(/\//gu, '\\')
}

function quotedArgument(value: string): string {
  if (BARE_ARGUMENT.test(value)) {
    return value
  }
  // A trailing backslash would escape the closing quote for CommandLineToArgvW.
  if (value === '' || UNQUOTABLE.test(value) || value.endsWith('\\')) {
    throw new MadangdWindowsCommandLineError(value)
  }
  return `"${value}"`
}

export function madangdWindowsNodeCommandLine(executable: string, args: readonly string[]): string {
  const program = windowsPath(executable)
  const argv = args.map(quotedArgument)
  if (BARE_EXECUTABLE.test(program)) {
    return [program, ...argv].join(' ')
  }
  // The inner line is single-quoted PowerShell inside one double-quoted argument both shells keep.
  for (const value of [program, ...args]) {
    if (UNQUOTABLE.test(value)) {
      throw new MadangdWindowsCommandLineError(value)
    }
  }
  const inner = ['&', ...[program, ...args].map(powerShellLiteral)].join(' ')
  return `powershell.exe -NoProfile -NonInteractive -Command "${inner}"`
}

export function madangdRemoteBaseDir(host: RemoteHostPlatform, remoteHome: string): string {
  return joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR)
}

export function madangdWindowsBaseDir(host: RemoteHostPlatform, slotDir: string): string {
  return remoteDirname(slotDir.replace(/\/+$/u, ''), host)
}

export function madangdWindowsPinnedNodePath(host: RemoteHostPlatform, baseDir: string): string {
  const target: NodeRuntimeTarget = host.arch === 'arm64' ? 'win32-arm64' : 'win32-x64'
  return joinRemotePath(
    host,
    baseDir,
    MADANGD_RUNTIMES_DIRNAME,
    `${MADANGD_NODE_RUNTIME_DIR_PREFIX}${pinnedNodeRuntimeAsset(target).executableSha256}`,
    MADANGD_NODE_RUNTIME_WINDOWS_EXECUTABLE
  )
}

function madangdWindowsHostScriptPath(host: RemoteHostPlatform, baseDir: string): string {
  return joinRemotePath(host, baseDir, MADANGD_WINDOWS_HOST_SCRIPT_FILENAME)
}

export function madangdWindowsHostOpCommand(
  host: RemoteHostPlatform,
  baseDir: string,
  op: MadangdWindowsHostOp,
  args: readonly string[]
): string {
  const fence = currentMadangdFence()
  return madangdWindowsNodeCommandLine(madangdWindowsPinnedNodePath(host, baseDir), [
    madangdWindowsHostScriptPath(host, baseDir),
    ...(fence ? [MADANGD_WINDOWS_FENCE_ARG, fence.lockDir, fence.token] : []),
    op,
    ...args
  ])
}

export function madangdWindowsSlotOpCommand(
  host: RemoteHostPlatform,
  slotDir: string,
  op: MadangdWindowsHostOp,
  args: readonly string[]
): string {
  return madangdWindowsHostOpCommand(host, madangdWindowsBaseDir(host, slotDir), op, args)
}

export function madangdWindowsHomeOpCommand(
  host: RemoteHostPlatform,
  remoteHome: string,
  op: MadangdWindowsHostOp,
  args: readonly string[]
): string {
  return madangdWindowsHostOpCommand(host, madangdRemoteBaseDir(host, remoteHome), op, args)
}

const stagedHostScripts = new WeakMap<MadangdHostTransport, Set<string>>()

/** Content-addressed scripts publish atomically so concurrent readers never see truncated code. */
export async function installMadangdWindowsHostScript(
  target: { conn: MadangdHostTransport; host: RemoteHostPlatform; signal?: AbortSignal },
  baseDir: string
): Promise<void> {
  const scriptPath = madangdWindowsHostScriptPath(target.host, baseDir)
  const staged = stagedHostScripts.get(target.conn) ?? new Set<string>()
  stagedHostScripts.set(target.conn, staged)
  if (staged.has(scriptPath)) {
    return
  }
  // Run staged host-script ops rather than inline code.
  const runOp = async (
    script: string,
    op: MadangdWindowsHostOp,
    args: string[]
  ): Promise<boolean> => {
    const command = madangdWindowsNodeCommandLine(madangdWindowsPinnedNodePath(target.host, baseDir), [
      script,
      op,
      ...args
    ])
    const answer = await execCommand(target.conn, command, {
      wrapCommand: false,
      signal: target.signal
    }).catch((error: unknown) => {
      if (isUnconfirmedSshCommandTermination(error)) {
        throw error
      }
      return ''
    })
    return answer.trim().split(/\r?\n/u).at(-1) === MADANGD_WINDOWS_HOST_SCRIPT_PRESENT
  }
  if (!(await runOp(scriptPath, 'script-present', []))) {
    const partial = `${scriptPath}.${randomUUID()}.partial`
    await target.conn.writeFile(partial, MADANGD_WINDOWS_HOST_SCRIPT, {
      hostPlatform: target.host,
      signal: target.signal
    })
    if (!(await runOp(partial, 'script-install', [scriptPath]))) {
      throw new Error(`Could not stage the madangd host script at ${scriptPath}.`)
    }
  }
  staged.add(scriptPath)
}

export function readMadangdWindowsEncodedAnswer(output: string, marker: string): string | null {
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .findLast((candidate) => candidate === marker || candidate.startsWith(`${marker} `))
  if (line === undefined) {
    return null
  }
  const encoded = line.slice(marker.length).trim()
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
    return null
  }
  return Buffer.from(encoded, 'base64').toString('utf8')
}
