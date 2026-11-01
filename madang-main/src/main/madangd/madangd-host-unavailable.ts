// Remember repeatable deployment refusals per app version; host-fixable settings must be reprobed.

export class MadangdHostUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MadangdHostUnsupportedError'
  }
}

export class MadangdArtifactsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MadangdArtifactsUnavailableError'
  }
}

export class MadangdStdioBridgeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MadangdStdioBridgeUnavailableError'
  }
}

export const MADANGD_TUNNEL_UNAVAILABLE_REASON = 'ssh_tunnel_unavailable'
export const MADANGD_WINDOWS_LAUNCH_REFUSED_CODE = 'madangd_windows_launch_refused'
export const MADANGD_WINDOWS_COMMAND_LINE_UNSAFE_CODE = 'madangd_windows_command_line_unsafe'

export type MadangdHostUnavailableReason =
  | 'unsupported_host'
  | 'artifacts_unavailable'
  | 'libc_unidentified'
  | 'runtime_self_test'
  | 'runtime_noexec'
  | 'windows_build_unsupported'
  | 'windows_no_extractor'
  | 'security_software'
  | 'native_preflight'
  | typeof MADANGD_TUNNEL_UNAVAILABLE_REASON

const UNAVAILABLE_BY_ERROR_NAME: Record<string, MadangdHostUnavailableReason> = {
  MadangdHostUnsupportedError: 'unsupported_host',
  MadangdArtifactsUnavailableError: 'artifacts_unavailable',
  MadangdRemoteLaunchUnsupportedError: 'unsupported_host',
  UnidentifiedHostLibcError: 'libc_unidentified',
  RemoteNodeRuntimeSelfTestError: 'runtime_self_test',
  RemoteNodeRuntimeNoexecError: 'runtime_noexec',
  RemoteWindowsBuildUnsupportedError: 'windows_build_unsupported',
  RemoteNodeRuntimeNoExtractorError: 'windows_no_extractor',
  RemoteNodeRuntimeSecurityModifiedError: 'security_software',
  MadangdStdioBridgeUnavailableError: MADANGD_TUNNEL_UNAVAILABLE_REASON,
  MadangdWindowsLaunchRefusedError: 'unsupported_host',
  MadangdWindowsCommandLineError: 'unsupported_host'
}

// Native preflight, PTY self-test and permanent Windows refusals repeat; transient races do not.
const UNAVAILABLE_BY_DEFERRAL_CODE: Record<string, MadangdHostUnavailableReason> = {
  madangd_candidate_preflight_failed: 'native_preflight',
  madangd_activation_pty_self_test_failed: 'native_preflight',
  [MADANGD_WINDOWS_LAUNCH_REFUSED_CODE]: 'unsupported_host',
  [MADANGD_WINDOWS_COMMAND_LINE_UNSAFE_CODE]: 'unsupported_host'
}

// Reprobed on every connect, so fixing or upgrading the host needs no new Orca version.
const FIXABLE_ON_HOST: ReadonlySet<string> = new Set<MadangdHostUnavailableReason>([
  'runtime_noexec',
  'windows_build_unsupported',
  'windows_no_extractor'
])

export function isMadangdHostUnavailableFixableOnHost(reason: string): boolean {
  return FIXABLE_ON_HOST.has(reason)
}

export function madangdCandidateLaunchFailureCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return code === MADANGD_WINDOWS_LAUNCH_REFUSED_CODE ||
    code === MADANGD_WINDOWS_COMMAND_LINE_UNSAFE_CODE
    ? code
    : 'madangd_candidate_launch_failed'
}

export function classifyMadangdHostUnavailable(failure: unknown): MadangdHostUnavailableReason | null {
  if (failure instanceof Error) {
    return UNAVAILABLE_BY_ERROR_NAME[failure.name] ?? null
  }
  if (failure && typeof failure === 'object' && 'code' in failure) {
    const code = failure.code
    return typeof code === 'string' ? (UNAVAILABLE_BY_DEFERRAL_CODE[code] ?? null) : null
  }
  return null
}
