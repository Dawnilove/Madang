// Remember failures only for this session so restarting retries once.
export type MadangdUpdateFailureHost = { kind: 'ssh' | 'wsl'; id: string }

export type MadangdUpdateFailure = { code: string; reason: string }

const failedThisLaunch = new Map<string, MadangdUpdateFailure>()

function key(host: MadangdUpdateFailureHost): string {
  return `${host.kind}:${host.id}`
}

export function recordMadangdUpdateFailedThisLaunch(
  host: MadangdUpdateFailureHost,
  failure: MadangdUpdateFailure
): void {
  failedThisLaunch.set(key(host), failure)
}

export function madangdUpdateFailureThisLaunch(
  host: MadangdUpdateFailureHost
): MadangdUpdateFailure | null {
  return failedThisLaunch.get(key(host)) ?? null
}

export function madangdUpdateFailedThisLaunch(host: MadangdUpdateFailureHost): boolean {
  return failedThisLaunch.has(key(host))
}

export function clearMadangdUpdateFailedThisLaunch(host: MadangdUpdateFailureHost): void {
  failedThisLaunch.delete(key(host))
}

export function resetMadangdUpdateFailuresForTests(): void {
  failedThisLaunch.clear()
}
