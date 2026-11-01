import type { ServeReadiness } from '../server/serve-readiness'
import type { MadangdManagedStopContext } from '../../shared/madangd-stop-request'

export type MadangdOptions = {
  port?: number
  json?: boolean
  noPairing?: boolean
  pairingAddress?: string
  /** Request a mobile-scoped pairing offer and terminal QR. */
  mobilePairing?: boolean
  grantDesktopControl?: boolean
  /** Print only the ephemeral-VM recipe line. */
  recipeJson?: boolean
  projectRoot?: string
  bind?: string
  /** Slots have no browser client; orca serve supplies the installed app client. */
  webClientRoot?: string
}

export type MadangdHandle = {
  readiness: ServeReadiness
  managedStop: MadangdManagedStopContext
  stop(): Promise<void>
}
