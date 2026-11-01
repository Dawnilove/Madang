import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import type { MadangdManagedServing } from './madangd-managed-serving'
import { verifyManagedTunnelServing } from './madangd-managed-tunnel'

/** Return unverifiable on failures rather than throwing. */
export function verifyMadangdManagedServing(
  userDataPath: string,
  selector: string
): Promise<MadangdManagedServing> {
  return Promise.resolve()
    .then(() => verifyManagedTunnelServing(resolveEnvironment(userDataPath, selector)))
    .catch((error: unknown) => ({ state: 'unverifiable', detail: String(error) }))
}
