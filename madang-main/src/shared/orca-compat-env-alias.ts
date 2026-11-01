// Import this first in every process entry: ES imports run before the entry body, and modules read
// MADANG_* at load time, so the old-name aliases must exist before any of them is evaluated.
import { applyLegacyEnvAliases } from './orca-compat-env'

applyLegacyEnvAliases()
