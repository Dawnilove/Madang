import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflightProfileStateRuntime } from '../persistence/profile-state/profile-state-runtime-preflight'
import {
  MADANGD_STARTUP_PREFLIGHT_FLAG,
  MADANGD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseMadangdProfilePreflight,
  madangdProfilePreflightResponseSchema,
  type MadangdProfilePreflightResponse
} from '../../shared/madangd-profile-preflight'
import { readMadangdArtifactIdentity } from './madangd-artifact-identity'
import { MADANGD_EXIT_CONFIGURATION } from './madangd-configuration-exit'
import { MADANGD_SERVER_ENTRY_FILENAME, MADANGD_VERSION_FILENAME } from '../../shared/madangd-artifacts'
import { MADANGD_NODE_RUNTIME_IDENTITY } from '../../shared/madangd-node-runtime-identity'
import { runProcess } from '@orca/process-host'
import { preflightMadangdNativeRuntime } from './madangd-runtime-native-preflight'
import { madangdCompileCacheEnv } from './madangd-compile-cache'
import {
  isRunningAsBundledMadangdRuntime,
  MadangdBundledRuntimeError,
  resolveBundledMadangdSlot
} from './madangd-bundled-runtime'

/** Qualify packaged startup before touching profile indexes, data-root locks or imports. */
export async function preflightBundledMadangdStartup(): Promise<void> {
  const directory = resolveBundledMadangdSlot()
  if (!isRunningAsBundledMadangdRuntime(directory)) {
    return
  }
  const identity = await readInstalledVersion(directory)
  const nonce = randomUUID()
  // Keep disposable SQLite ownership and native state out of the serving process.
  const result = await runProcess({
    program: process.execPath,
    args: [join(directory, MADANGD_SERVER_ENTRY_FILENAME), MADANGD_STARTUP_PREFLIGHT_FLAG, nonce],
    // Reuse the serving runtime code cache for this identical bundle.
    env: { ...process.env, MADANG_BACKGROUND_LAUNCH: '1', ...madangdCompileCacheEnv(directory) },
    timeoutMs: MADANGD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    maxOutputBytes: 64 * 1024,
    terminationBarrier: true
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    const Failure = result.code === MADANGD_EXIT_CONFIGURATION ? MadangdBundledRuntimeError : Error
    throw new Failure(`The bundled Madang runtime failed readiness: ${result.stderr}`)
  }
  try {
    parseMadangdProfilePreflight(result.stdout, nonce, MADANGD_NODE_RUNTIME_IDENTITY, identity)
  } catch (cause) {
    throw new MadangdBundledRuntimeError('The bundled runtime returned invalid readiness identity', {
      cause
    })
  }
}

export async function runMadangdProfilePreflight(
  nonce: string | undefined,
  options: { nativeFeatures?: boolean } = {}
): Promise<void> {
  const checkedNonce = z.string().uuid().parse(nonce)
  const directory = resolveBundledMadangdSlot()
  let artifactVersion: string
  try {
    artifactVersion = await readMadangdArtifactIdentity(directory)
  } catch (cause) {
    throw new MadangdBundledRuntimeError('The bundled Madang artifacts are incomplete or altered', {
      cause
    })
  }
  const result = await preflightProfileStateRuntime()
  // Host Node rollback launchers do not serve the bundled slot.
  if (isRunningAsBundledMadangdRuntime(directory)) {
    await preflightMadangdNativeRuntime(options)
  }
  const response: MadangdProfilePreflightResponse = {
    type: 'orca_profile_state_ready',
    nonce: checkedNonce,
    runtime: 'node',
    runtimeVersion: process.versions.node,
    artifactVersion,
    ...result
  }
  console.log(JSON.stringify(response))
}

async function readInstalledVersion(directory: string): Promise<string> {
  try {
    return madangdProfilePreflightResponseSchema.shape.artifactVersion.parse(
      (await readFile(join(directory, MADANGD_VERSION_FILENAME), 'utf8')).trim()
    )
  } catch (cause) {
    throw new MadangdBundledRuntimeError(
      'The installed Madang artifact version is missing or invalid',
      {
        cause
      }
    )
  }
}
