/** Before Add persists its record, removal/disable/startup cannot find the connection or detached holder. Every unsuccessful Add must release both here. */
import { errorMessage } from '../../shared/error-message'
import type { WslHostAddResult } from '../../shared/wsl-host-types'
import { MadangdHostUnsupportedError } from '../madangd/madangd-host-unavailable'
import type { WslHostConnector } from './wsl-host-service'
import { WslMadangdLaunchDeferredError } from './wsl-madangd-connection-errors'
import type { WslMadangdConnection } from './wsl-madangd-connection'

type WslHostAddRefusal = Extract<WslHostAddResult, { ok: false }>
type AddConnector = Pick<WslHostConnector, 'connect' | 'disconnect' | 'releaseHolder'>

export async function abandonWslHostAdd(connector: AddConnector, distro: string): Promise<void> {
  await connector.disconnect(distro).catch(() => {})
  await connector.releaseHolder(distro).catch(() => {})
}

/** `lateRefusal` is re-read once the connect lands: the setting can change while it runs. */
export async function connectForWslHostAdd(
  connector: AddConnector,
  distro: string,
  lateRefusal: () => WslHostAddRefusal | null
): Promise<{ connection: WslMadangdConnection } | WslHostAddRefusal> {
  let connection: WslMadangdConnection
  try {
    connection = await connector.connect(distro)
  } catch (error) {
    await abandonWslHostAdd(connector, distro)
    if (error instanceof WslMadangdLaunchDeferredError) {
      return { ok: false, kind: 'deferred', message: error.launch.reason }
    }
    return {
      ok: false,
      kind: error instanceof MadangdHostUnsupportedError ? 'unsupported-wsl1' : 'failed',
      message: errorMessage(error)
    }
  }
  const refusal = lateRefusal()
  if (refusal) {
    await abandonWslHostAdd(connector, distro)
    return refusal
  }
  return { connection }
}
