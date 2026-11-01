import type { MadangdDeploymentLink } from './runtime-environments'
import type { MadangdWslDeploymentLink } from './wsl-host-deployment-link'

/** Switch exhaustively on kind: network includes SSH tunnels; wsl uses this computer’s wsl.exe bridge. */
export type RuntimeEnvironmentHost<T> =
  | { kind: 'network'; environment: T }
  | { kind: 'wsl'; environment: T; deployment: MadangdWslDeploymentLink }

export function classifyRuntimeEnvironmentHost<
  T extends { madangdDeployment?: MadangdDeploymentLink | null }
>(environment: T): RuntimeEnvironmentHost<T> {
  const deployment = environment.madangdDeployment
  if (!deployment) {
    return { kind: 'network', environment }
  }
  switch (deployment.kind) {
    // Why undefined: SSH deployment links are persisted without their kind.
    case undefined:
    case 'ssh':
      return { kind: 'network', environment }
    case 'wsl':
      return { kind: 'wsl', environment, deployment }
  }
}
