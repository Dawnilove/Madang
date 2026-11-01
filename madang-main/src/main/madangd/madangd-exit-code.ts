import { MadangdBindAddressError } from './madangd-bind-address'
import { MadangdBundledRuntimeError } from './madangd-bundled-runtime'
import { MadangdInstanceLockError } from './madangd-data-root-privacy'
import { ProfileStateAccessError } from '../persistence/profile-state/profile-state-access'
import { MADANGD_EXIT_CONFIGURATION } from './madangd-configuration-exit'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../shared/single-instance-exit-code'

export const MADANGD_EXIT_FAILED = 1

export function resolveMadangdExitCode(error: unknown): number {
  // Supervisors wait for an existing holder instead of abandoning the host.
  if (
    error instanceof MadangdInstanceLockError &&
    error.code === 'madangd_instance_lock_holder_unverifiable'
  ) {
    return SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
  }
  return error instanceof MadangdInstanceLockError ||
    error instanceof MadangdBindAddressError ||
    error instanceof MadangdBundledRuntimeError ||
    error instanceof ProfileStateAccessError
    ? MADANGD_EXIT_CONFIGURATION
    : MADANGD_EXIT_FAILED
}
