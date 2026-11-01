export function resolveDiagnosticBuildTokenEndpoint(): string | null {
  const endpoint =
    typeof MADANG_DIAGNOSTICS_TOKEN_URL !== 'undefined'
      ? MADANG_DIAGNOSTICS_TOKEN_URL
      : ((globalThis as { MADANG_DIAGNOSTICS_TOKEN_URL?: string | null })
          .MADANG_DIAGNOSTICS_TOKEN_URL ?? null)
  return typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : null
}

export function resolveDiagnosticBuildIdentity(): 'stable' | 'rc' | null {
  const ident =
    typeof MADANG_BUILD_IDENTITY !== 'undefined'
      ? MADANG_BUILD_IDENTITY
      : ((globalThis as { MADANG_BUILD_IDENTITY?: 'stable' | 'rc' | null }).MADANG_BUILD_IDENTITY ??
        null)
  return ident === 'stable' || ident === 'rc' ? ident : null
}

export function resolveDiagnosticTokenEndpoint(): string | null {
  const buildEndpoint = resolveDiagnosticBuildTokenEndpoint()
  // Pin official builds to the support endpoint named by the UI, regardless of user environment.
  if (resolveDiagnosticBuildIdentity()) {
    return buildEndpoint
  }
  const fromEnv = process.env.MADANG_DIAGNOSTICS_TOKEN_URL
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
  }
  return buildEndpoint
}

export function resolveDiagnosticOrcaChannel(): 'stable' | 'rc' | 'dev' {
  const ident = resolveDiagnosticBuildIdentity()
  if (ident === 'stable' || ident === 'rc') {
    return ident
  }
  return 'dev'
}
