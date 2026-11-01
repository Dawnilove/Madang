export const MADANGD_PAIRING_REPAIR_FAILED_CODE = 'madangd_pairing_repair_failed'

export class MadangdManagedPairingRepairFailedError extends Error {
  readonly code = MADANGD_PAIRING_REPAIR_FAILED_CODE
  constructor(reason: string) {
    super(
      `${MADANGD_PAIRING_REPAIR_FAILED_CODE}: the Madang server on this host no longer accepts this ` +
        `computer, and Madang couldn't pair with it again over SSH: ${reason}. Nothing on the host ` +
        `was stopped; its terminals can't be verified until Madang pairs again. Connect again to retry.`
    )
    this.name = 'MadangdManagedPairingRepairFailedError'
  }
}
