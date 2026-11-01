import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { constants } from 'node:os'
import { spawnProcess } from '@orca/process-host'
import { resolveMadangdInstallRoot } from './madangd-app-paths'
import { MADANGD_EXIT_CONFIGURATION } from './madangd-configuration-exit'
import {
  MADANGD_NODE_RUNTIME_MARKER_FILENAME,
  MADANGD_SERVER_TARGET_FILENAME,
  MADANGD_VERSION_FILENAME,
  madangdNodeRuntimeRelativePath
} from '../../shared/madangd-artifacts'
import { NODE_RUNTIME_PIN, nodeRuntimeAsset } from '../../shared/node-runtime-pin'

export class MadangdBundledRuntimeError extends Error {}
export const MADANGD_BUNDLED_LAUNCHER_ENV = 'MADANG_BUNDLED_LAUNCHER_CHANNEL'

/** Null for unpackaged entries; reject torn/foreign runtime references in packaged slots. */
export function resolveBundledMadangdRuntime(directory: string): string | null {
  const markerPath = join(directory, MADANGD_NODE_RUNTIME_MARKER_FILENAME)
  const targetPath = join(directory, MADANGD_SERVER_TARGET_FILENAME)
  const hasMarker = existsSync(markerPath)
  const hasTarget = existsSync(targetPath)
  if (!hasMarker && !hasTarget && !existsSync(join(directory, MADANGD_VERSION_FILENAME))) {
    return null
  }
  if (!hasTarget) {
    throw new MadangdBundledRuntimeError('The bundled Madang runtime target is missing')
  }
  if (!hasMarker) {
    throw new MadangdBundledRuntimeError('The bundled Madang runtime reference is missing')
  }
  const target = readFileSync(targetPath, 'utf8').trim()
  // Compat targets use the same Node version built for older glibc.
  const asset = nodeRuntimeAsset(target)
  if (!asset) {
    throw new MadangdBundledRuntimeError(`The bundled Madang runtime target is invalid: ${target}`)
  }
  const executableSha256 = readFileSync(markerPath, 'utf8').trim()
  // Validate the exact runtime pin: this marker becomes a path segment.
  if (executableSha256 !== asset.executableSha256) {
    throw new MadangdBundledRuntimeError(
      `The bundled Madang runtime reference does not name Node ${NODE_RUNTIME_PIN.version}`
    )
  }
  const runtime = join(directory, ...madangdNodeRuntimeRelativePath(target, executableSha256))
  if (!existsSync(runtime)) {
    throw new MadangdBundledRuntimeError('The bundled Madang runtime is missing')
  }
  return runtime
}

export function resolveBundledMadangdSlot(script = process.argv[1]): string {
  return resolveMadangdInstallRoot(script && realpathSync(script))
}

export function isRunningAsBundledMadangdRuntime(directory: string): boolean {
  const runtime = resolveBundledMadangdRuntime(directory)
  return runtime !== null && realpathSync(process.execPath) === realpathSync(runtime)
}

/** Reject substituted runtimes before opening profile state. */
export function assertMadangdServerRuntime(): void {
  if (Number(process.versions.node.split('.')[0]) < 18) {
    throw new MadangdBundledRuntimeError('The Madang server requires Node.js 18 or newer')
  }
  const directory = resolveBundledMadangdSlot()
  const runtime = resolveBundledMadangdRuntime(directory)
  if (runtime && !isRunningAsBundledMadangdRuntime(directory)) {
    throw new MadangdBundledRuntimeError('Start the Madang server with its bundled Node.js runtime')
  }
  if (runtime && process.versions.node !== NODE_RUNTIME_PIN.version) {
    throw new MadangdBundledRuntimeError(
      `The bundled Madang runtime must be Node ${NODE_RUNTIME_PIN.version}`
    )
  }
}

/** Hand old service commands to pinned Node before they can open profile state. */
export function handoffToBundledMadangd(): boolean {
  const script = process.argv[1]
  if (!script) {
    return false
  }
  const entry = realpathSync(script)
  const runtime = resolveBundledMadangdRuntime(dirname(entry))
  if (!runtime) {
    return false
  }
  if (realpathSync(process.execPath) === realpathSync(runtime)) {
    if (process.versions.node !== NODE_RUNTIME_PIN.version) {
      throw new MadangdBundledRuntimeError(
        `The bundled Madang runtime must be Node ${NODE_RUNTIME_PIN.version}`
      )
    }
    return false
  }
  const child = spawnProcess({
    program: runtime,
    args: [entry, ...process.argv.slice(2)],
    env: { ...process.env, [MADANGD_BUNDLED_LAUNCHER_ENV]: '1' },
    // Detach so Windows child jobs cannot kill the runtime before launcher-disconnect cleanup.
    detached: true,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  })
  // Node resets nohup; stop through INT/TERM or owner loss instead.
  const ignoreHangup = (): void => {}
  if (process.platform !== 'win32') {
    process.on('SIGHUP', ignoreHangup)
  }
  const forwards = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    const forward = (): void => {
      if (process.platform === 'win32') {
        // Detached Windows children have their own console; disconnect allows durable shutdown.
        if (child.connected) {
          child.disconnect()
        }
      } else {
        child.kill(signal)
      }
    }
    process.on(signal, forward)
    return { signal, forward }
  })
  const cleanup = (): void => {
    process.off('SIGHUP', ignoreHangup)
    for (const { signal, forward } of forwards) {
      process.off(signal, forward)
    }
  }
  child.once('error', (error) => {
    cleanup()
    console.error('madangd: could not start the bundled runtime:', error.message)
    process.exit(MADANGD_EXIT_CONFIGURATION)
  })
  child.once('exit', (code, signal) => {
    cleanup()
    if (signal && process.platform !== 'win32') {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? (signal ? 128 + constants.signals[signal] : 1))
  })
  return true
}
