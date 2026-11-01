/** The CLI runs the packaged selection entry under ELECTRON_RUN_AS_NODE and reads one line, avoiding app-side imports. */
export const SERVE_RUNTIME_ENV = 'MADANG_SERVE_RUNTIME'
/** `MADANG_SERVE_RUNTIME=electron` keeps `orca serve` on Electron; madangd is the default. */
export const SERVE_RUNTIME_ELECTRON = 'electron'
export const MADANGD_LOCAL_SERVE_SELECTION_ENTRY = 'madangd/madangd-local-serve-selection-entry'
export const MADANGD_LOCAL_SERVE_SELECTION_FLAGS = {
  userData: '--user-data',
  appRoot: '--app-root'
} as const
const RESULT_MARKER = 'MADANG_SERVE_RUNTIME'

export type ServeRuntimeSelection =
  | { kind: 'madangd'; runtime: string; entry: string; version: string }
  /** `reason` is null when Electron was asked for explicitly, so nothing is printed. */
  | { kind: 'electron'; reason: string | null }

export function formatServeRuntimeSelection(selection: ServeRuntimeSelection): string {
  return `${RESULT_MARKER} ${JSON.stringify(selection)}`
}

/** The last result line in `output`, or null when none parses. */
export function parseServeRuntimeSelection(output: string): ServeRuntimeSelection | null {
  const line = output
    .split(/\r?\n/u)
    .findLast((candidate) => candidate.startsWith(`${RESULT_MARKER} `))
  if (!line) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(line.slice(RESULT_MARKER.length + 1))
    if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) {
      return null
    }
    const record = Object.fromEntries(Object.entries(parsed))
    if (
      record.kind === 'madangd' &&
      typeof record.runtime === 'string' &&
      typeof record.entry === 'string' &&
      typeof record.version === 'string'
    ) {
      return {
        kind: 'madangd',
        runtime: record.runtime,
        entry: record.entry,
        version: record.version
      }
    }
    if (record.kind === 'electron') {
      return { kind: 'electron', reason: typeof record.reason === 'string' ? record.reason : null }
    }
    return null
  } catch {
    return null
  }
}
