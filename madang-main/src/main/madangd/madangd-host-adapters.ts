import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { MADANGD_CLI_PACKAGE_FILENAME } from '../../shared/madangd-artifacts'
import { setAppEnvironment, type AppEnvironment } from '../../shared/app-environment'
import { setSecretStore } from '../../shared/secret-store'
import { resolveMadangdInstallRoot, resolveMadangdPath } from './madangd-app-paths'
import { getMadangdCliLauncherPath } from './madangd-cli-launcher'
import { createMadangdSecretStore, type MadangdSecretStore } from './madangd-secret-store'
import { setSpeechServiceFactories } from '../speech/speech-runtime-service'
import { madangdSpeechServiceFactories } from './madangd-speech-services'

let quitRegisteredHandlers = (): void => {}

export function runMadangdQuitHandlers(): void {
  quitRegisteredHandlers()
}

function createNodeAppEnvironment(): AppEnvironment {
  const quitHandlers: (() => void)[] = []
  // Synchronous quit handlers must not preempt the signal handler’s awaited runtime/browser teardown.
  quitRegisteredHandlers = (): void => {
    const errors: unknown[] = []
    for (const handler of quitHandlers.splice(0)) {
      try {
        handler()
      } catch (error) {
        errors.push(error)
      }
    }
    // Failed handlers may leave writers running and keep the instance lock held.
    if (errors.length > 0) {
      throw new AggregateError(errors, 'madangd_quit_handlers_failed')
    }
  }
  return {
    getPath: resolveMadangdPath,
    getAppPath: () => resolveMadangdInstallRoot(),
    getVersion: () => process.env.MADANG_VERSION ?? '0.0.0-madangd',
    // Packaged gates production HTTPS/CLI/PATH policy; layout callers must inspect asar separately.
    isPackaged: () => true,
    getCliLauncherPath: getMadangdCliLauncherPath,
    onWillQuit: (handler) => quitHandlers.push(handler),
    exit: (code = 0) => process.exit(code),
    getAppMetrics: () => []
  }
}

let madangdSecretStore: MadangdSecretStore | null = null

export async function prepareMadangdSecretStore(
  keyDir: string,
  userDataPath: string
): Promise<boolean> {
  if (!madangdSecretStore) {
    throw new Error('madangd_secret_store_not_installed — call installMadangdHostAdapters() first')
  }
  return madangdSecretStore.prepare({ keyDir, userDataPath })
}

/** Stamp the bundle’s own release so inherited desktop versions cannot misidentify this server. */
export function stampMadangdAppVersion(installRoot: () => string = resolveMadangdInstallRoot): void {
  let version: unknown
  try {
    const path = join(installRoot(), ...MADANGD_CLI_PACKAGE_FILENAME.split('/'))
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    version = parsed && typeof parsed === 'object' && 'version' in parsed ? parsed.version : null
  } catch {
    return
  }
  if (typeof version === 'string' && version.length > 0) {
    process.env.MADANG_APP_VERSION = version
  }
}

export function installMadangdHostAdapters(): void {
  stampMadangdAppVersion()
  setAppEnvironment(createNodeAppEnvironment())
  madangdSecretStore = createMadangdSecretStore()
  setSecretStore(madangdSecretStore)
  setSpeechServiceFactories(madangdSpeechServiceFactories)
}
