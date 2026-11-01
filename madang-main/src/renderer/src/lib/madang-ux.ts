import { MADANG_UX, ORCA_UX_DEFAULTS, type MadangUx } from '../../../shared/madang-features'
import { e2eConfig } from './e2e-config'

/** MADANG_UX as this window sees it: e2e launches with MADANG_E2E_ORCA_DEFAULTS=1 get Orca's own values. */
export const madangUx: MadangUx = e2eConfig.orcaDefaults ? ORCA_UX_DEFAULTS : MADANG_UX
