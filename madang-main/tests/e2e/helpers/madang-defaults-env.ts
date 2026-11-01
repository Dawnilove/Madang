/** Upstream specs expect Orca's UI defaults (Orca shell, system language, chat off), not Madang's; see src/shared/madang-features.ts. */
export const E2E_ORCA_DEFAULTS_ENV = { MADANG_E2E_ORCA_DEFAULTS: '1' } as const
