// Older hosts lack terminalCensus; absent capability means unverifiable, never zero terminals.
export const MADANGD_TERMINAL_CENSUS_RUNTIME_CAPABILITY = 'madangd.terminal-census.v1' as const

// Absent capability refuses migration operations instead of calling missing methods on older hosts.
export const MADANGD_MIGRATION_CATALOG_RUNTIME_CAPABILITY = 'madangd.migration-catalog.v1' as const

// Abort by reference releases fences whose manifest cannot fit a request (before #30836). Older hosts lack this method.
export const MADANGD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY =
  'madangd.migration-catalog-abort-by-reference.v1' as const

// Gate each non-SSH source kind: older destinations strip source.kind and could misread WSL as SSH.
// Advertise local-wsl only once the destination parses that discriminator.
export const MADANGD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY =
  'madangd.migration-source.local-wsl.v1' as const

// The blob channel also requires each installed kind’s madangd.migration-blob.<kind>.v1 capability.
export const MADANGD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY = 'madangd.migration-blob.v1' as const

// Push desktop-owned host accounts (WSL) only to hosts supporting accounts.setHostLaunchEnv.
export const HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY = 'accounts.host-launch-env.v1' as const

// Older madangds reject --reclaim-stale-lock; without this capability offer manual instructions.
export const MADANGD_STALE_LOCK_RECLAIM_RUNTIME_CAPABILITY = 'madangd.stale-lock-reclaim.v1' as const

export const MADANGD_RUNTIME_CAPABILITIES = [
  MADANGD_STALE_LOCK_RECLAIM_RUNTIME_CAPABILITY,
  MADANGD_TERMINAL_CENSUS_RUNTIME_CAPABILITY,
  MADANGD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
  MADANGD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY,
  HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY
] as const
