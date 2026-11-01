import { NODE_RUNTIME_PIN } from './node-runtime-pin'
import type { MadangdPreflightRuntimeIdentity } from './madangd-profile-preflight'

/** What a Node slot's candidate must report: the pinned runtime, never a host Node. */
export const MADANGD_NODE_RUNTIME_IDENTITY: MadangdPreflightRuntimeIdentity = {
  runtime: 'node',
  runtimeVersion: NODE_RUNTIME_PIN.version
}
