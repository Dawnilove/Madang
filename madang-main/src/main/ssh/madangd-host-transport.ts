import type { SshTarget } from '../../shared/ssh-types'
import type { WslMadangdHostTarget } from '../wsl/wsl-madangd-host-target'
import type { RemoteInstallTransport } from '../managed-server/install/remote-install-transport'
import type { MadangdLaunchDetach } from '../managed-server/install/madangd-remote-launch'

/** Only id/label have the same meaning across host kinds. */
export type MadangdHostTarget = SshTarget | WslMadangdHostTarget

export function isWslMadangdHostTarget(target: MadangdHostTarget): target is WslMadangdHostTarget {
  return 'kind' in target && target.kind === 'wsl'
}

export type MadangdHostTransport = RemoteInstallTransport & {
  getTarget(): MadangdHostTarget
  /** Absent on SSH, which detaches with nohup. */
  readonly madangdLaunchDetach?: MadangdLaunchDetach
  /** Pass client-only host facts at launch; SSH adds none. */
  readonly madangdLaunchEnv?: () => Promise<readonly MadangdLaunchEnvEntry[]>
}

export type MadangdLaunchEnvEntry = readonly [name: string, value: string]
