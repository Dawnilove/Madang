import type { MadangdManagedRefusal } from './madangd-managed-runtime'
import type { MadangdDaemonRetirementVerdict } from './madangd-stop-request'

export type MadangdDecommissionResult =
  | {
      outcome: 'decommissioned'
      version: string
      /** The daemon's fate: `retired`, or kept with its terminals (`live`/`unverifiable`). */
      retirement: MadangdDaemonRetirementVerdict
    }
  | MadangdManagedRefusal
