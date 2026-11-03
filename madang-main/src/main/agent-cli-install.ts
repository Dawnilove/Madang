import { spawn as nodeSpawn } from 'node:child_process'
import {
  AGENT_CLI_INSTALL_COMMANDS,
  isInstallableAgentCli,
  type InstallAgentCliResult
} from '../shared/agent-cli-install'
import { isCompanyEdition } from '../shared/madang-edition'

type SpawnFn = typeof nodeSpawn

/** Message left on screen when the installer window ends, so the user can read the result before it closes. */
const PAUSE_PROMPT = 'Install finished. Press Enter to close this window.'

/**
 * Opens a visible PowerShell window that runs the vendor's official install one-liner. The user watches the
 * output and closes the window; nothing runs hidden. Windows only; the company edition never offers it.
 */
export function installAgentCli(
  agent: unknown,
  options: { platform?: NodeJS.Platform; spawn?: SpawnFn } = {}
): Promise<InstallAgentCliResult> {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32' || isCompanyEdition() || !isInstallableAgentCli(agent)) {
    return Promise.resolve({ status: 'unsupported' })
  }
  const spawn = options.spawn ?? nodeSpawn
  const command = `${AGENT_CLI_INSTALL_COMMANDS[agent]}; Write-Host ''; Read-Host '${PAUSE_PROMPT}' | Out-Null`
  return new Promise((resolve) => {
    try {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { windowsHide: false, stdio: 'ignore' }
      )
      child.on('error', (error) => resolve({ status: 'failed', error: error.message }))
      child.on('close', (exitCode) => resolve({ status: 'finished', exitCode }))
    } catch (error) {
      resolve({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  })
}
