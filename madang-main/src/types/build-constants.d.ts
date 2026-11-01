// CI release builds substitute telemetry credentials; contributor builds use null and console-mirror only.
// No runtime env fallback: shell exports must not enable telemetry transmission.
declare const MADANG_BUILD_IDENTITY: 'stable' | 'rc' | null
declare const MADANG_POSTHOG_WRITE_KEY: string | null

// CI supplies the diagnostics token endpoint; null disables upload in contributor builds.
// MADANG_DIAGNOSTICS_TOKEN_URL overrides it for developers testing packaged builds against staging.
declare const MADANG_DIAGNOSTICS_TOKEN_URL: string | null

// Full commit the build was made from (`git rev-parse HEAD`); official skill installs pin to it.
declare const MADANG_BUILD_COMMIT: string

// MADANG_LAYOUT_OWNER is declared and read in one place: src/shared/layout-owner-switch.ts.
