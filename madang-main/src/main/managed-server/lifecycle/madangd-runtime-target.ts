import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { resolveMadangdDeploymentTargetFacts } from '../../ssh/madangd-deployment-target'
import { MadangdHostUnsupportedError } from '../../madangd/madangd-host-unavailable'
import type { MadangdHostTransport } from '../../ssh/madangd-host-transport'
import { pinnedRuntimeTargetForHost } from '../../ssh/pinned-runtime-host-target'
import type { RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

export async function resolveMadangdRuntimeTarget(options: {
  conn: MadangdHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  exec?: (command: string) => Promise<string>
}): Promise<NodeRuntimeTarget> {
  const facts = await resolveMadangdDeploymentTargetFacts(options)
  const target = pinnedRuntimeTargetForHost(facts)
  if (!target) {
    const glibc = facts.glibc ? `${facts.glibc.major}.${facts.glibc.minor}` : 'unknown'
    throw new MadangdHostUnsupportedError(
      `No Madang runtime supports ${facts.target} with glibc ${glibc}.`
    )
  }
  return target
}
