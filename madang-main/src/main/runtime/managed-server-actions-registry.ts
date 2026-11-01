/** Desktop main publishes managed-server actions for runtime RPC; headless hosts without a registry advertise none. */
import type {
  MadangdManagedPastLiveTerminals,
  MadangdManagedCancelStopResult,
  MadangdManagedDeployResult,
  MadangdManagedForgetResult,
  MadangdManagedRecoveryResult,
  MadangdManagedRollbackResult,
  MadangdManagedRuntimeStatus,
  MadangdManagedStopResult
} from '../../shared/madangd-managed-runtime'

export type ManagedServerActions = {
  status: (selector: string) => Promise<MadangdManagedRuntimeStatus>
  update: (
    selector: string,
    force: boolean,
    pastLiveTerminals?: MadangdManagedPastLiveTerminals
  ) => Promise<MadangdManagedDeployResult>
  rollback: (selector: string) => Promise<MadangdManagedRollbackResult>
  /** `acceptChangedState` restores the snapshot over state a rejected build changed. */
  recover: (selector: string, acceptChangedState?: boolean) => Promise<MadangdManagedRecoveryResult>
  stop: (selector: string) => Promise<MadangdManagedStopResult>
  cancelStop: (selector: string) => Promise<MadangdManagedCancelStopResult>
  forget: (selector: string) => Promise<MadangdManagedForgetResult>
}

let registered: ManagedServerActions | null = null

export function registerManagedServerActions(actions: ManagedServerActions | null): void {
  registered = actions
}

export function getManagedServerActions(): ManagedServerActions | null {
  return registered
}
