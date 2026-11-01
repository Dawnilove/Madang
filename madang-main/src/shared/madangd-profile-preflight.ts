import { z } from 'zod'

export const MADANGD_PROFILE_PREFLIGHT_FLAG = '--madangd-profile-state-preflight'
export const MADANGD_STARTUP_PREFLIGHT_FLAG = '--madangd-startup-preflight'
export const MADANGD_PROFILE_PREFLIGHT_TIMEOUT_MS = 90_000
// Server startup follows the disposable native/SQLite probe on every bundled launch.
export const MADANGD_STARTUP_READINESS_TIMEOUT_MS = MADANGD_PROFILE_PREFLIGHT_TIMEOUT_MS + 90_000

export const MADANGD_PREFLIGHT_RUNTIMES = ['node', 'bun'] as const

/** The runtime the caller launched; the candidate must prove it ran under exactly this one. */
export type MadangdPreflightRuntimeIdentity = {
  runtime: (typeof MADANGD_PREFLIGHT_RUNTIMES)[number]
  runtimeVersion: string
}

export const madangdProfilePreflightResponseSchema = z.object({
  type: z.literal('orca_profile_state_ready'),
  nonce: z.string().uuid(),
  runtime: z.enum(MADANGD_PREFLIGHT_RUNTIMES),
  runtimeVersion: z.string().min(1),
  artifactVersion: z.string().regex(/^\d+\.\d+\.\d+\+[a-f0-9]{12}$/),
  sqliteVersion: z.string().min(1),
  revision: z.number().int().positive()
})

export type MadangdProfilePreflightResponse = z.infer<typeof madangdProfilePreflightResponseSchema>

/** A fresh challenge prevents stale or unrelated output from admitting a candidate. */
export function parseMadangdProfilePreflight(
  output: string,
  nonce: string,
  expected: MadangdPreflightRuntimeIdentity,
  artifactVersion?: string
): MadangdProfilePreflightResponse {
  const response = madangdProfilePreflightResponseSchema.parse(JSON.parse(output.trim()))
  if (
    response.nonce !== nonce ||
    response.runtime !== expected.runtime ||
    response.runtimeVersion !== expected.runtimeVersion ||
    (artifactVersion !== undefined && response.artifactVersion !== artifactVersion)
  ) {
    throw new Error('Profile preflight did not run under the expected candidate runtime')
  }
  return response
}
