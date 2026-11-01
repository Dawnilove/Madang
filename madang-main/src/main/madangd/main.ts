import '../../shared/orca-compat-env-alias'
import process from 'node:process'
import { main } from './madangd-entry'
import { resolveMadangdExitCode } from './madangd-exit-code'
import { reserveServeStdoutForReadiness } from '../server/serve-stdout-boundary'
import { runMadangdNativePreflight } from './madangd-native-preflight'
import {
  MADANGD_PROFILE_PREFLIGHT_FLAG,
  MADANGD_STARTUP_PREFLIGHT_FLAG
} from '../../shared/madangd-profile-preflight'
import { preflightBundledMadangdStartup, runMadangdProfilePreflight } from './madangd-profile-preflight'
import { assertMadangdServerRuntime } from './madangd-bundled-runtime'
import {
  formatMadangdNativePreflightReport,
  MADANGD_NATIVE_PREFLIGHT_FLAG
} from '../../shared/madangd-native-preflight-report'
import {
  MADANGD_CANCEL_MANAGED_STOP_FLAG,
  MADANGD_COMPLETE_MANAGED_STOP_FLAG
} from '../../shared/madangd-stop-request'
import {
  MADANGD_WINDOWS_BREAKAWAY_CONTRACT,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG
} from '../../shared/windows-breakaway-launch'
import { runWindowsBreakawayLaunchIfRequested } from '../../shared/windows-breakaway-launcher'
import { parseArgs } from './madangd-command-arguments'
import { MADANGD_RECLAIM_STALE_LOCK_FLAG } from '../../shared/madangd-stale-lock-reclaim'

// A resolved plain-Node module graph proves the build guard; skip probes, ports and data-root locks.
if (process.argv.includes('--madangd-smoke-load-check')) {
  process.exit(0)
}

function failStartup(error: unknown): void {
  console.error('madangd: failed to start:', error)
  // Distinguish configuration refusals so supervisors cannot restart-spin on them.
  process.exit(resolveMadangdExitCode(error))
}

// One-shot launch and stop commands must skip server startup and preflights.
if (process.argv[2] === '--madangd-structured-provider-load-check') {
  void import('./madangd-structured-provider-smoke')
    .then(({ smokeLoadMadangdStructuredProviders }) => smokeLoadMadangdStructuredProviders())
    .then(() => process.exit(0))
    .catch(failStartup)
} else if (process.argv[2] === WINDOWS_BREAKAWAY_LAUNCH_FLAG) {
  runWindowsBreakawayLaunchIfRequested(MADANGD_WINDOWS_BREAKAWAY_CONTRACT, process.argv)
} else if (
  process.argv[2] === MADANGD_COMPLETE_MANAGED_STOP_FLAG ||
  process.argv[2] === MADANGD_CANCEL_MANAGED_STOP_FLAG
) {
  void import('./madangd-managed-stop-command').then(({ runMadangdManagedStopCommandAndExit }) =>
    runMadangdManagedStopCommandAndExit(process.argv.slice(2))
  )
} else if (process.argv[2] === MADANGD_RECLAIM_STALE_LOCK_FLAG) {
  void import('./madangd-stale-lock-reclaim').then(({ runMadangdStaleLockReclaimCommandAndExit }) =>
    runMadangdStaleLockReclaimCommandAndExit(process.argv.slice(2))
  )
} else {
  startMadangdProcess()
}

function startMadangdProcess(): void {
  try {
    const argv = process.argv.slice(2)
    if ((argv.includes('--help') || argv.includes('-h')) && parseArgs(argv).help) {
      void main(argv).catch(failStartup)
      return
    }
    assertMadangdServerRuntime()
    const flag = process.argv[2]
    if (flag === MADANGD_NATIVE_PREFLIGHT_FLAG && process.argv.length === 3) {
      void import('./node-pty-precondition').then(({ checkNodePtyPrecondition }) => {
        const verdict = checkNodePtyPrecondition()
        const report = formatMadangdNativePreflightReport(verdict.status, verdict.reason ?? null)
        process.stdout.write(`${report}\n`, () => process.exit(0))
      }, failStartup)
    } else if (
      (flag === MADANGD_PROFILE_PREFLIGHT_FLAG || flag === MADANGD_STARTUP_PREFLIGHT_FLAG) &&
      process.argv.length === 4
    ) {
      void runMadangdProfilePreflight(process.argv[3], {
        nativeFeatures: flag === MADANGD_PROFILE_PREFLIGHT_FLAG
      })
        // The owner reads EOF; lingering native handles must not keep this probe alive.
        .then(() => process.stdout.write('', () => process.exit(0)))
        .catch(failStartup)
    } else {
      // Stdout is the readiness API; send incidental diagnostics to stderr.
      reserveServeStdoutForReadiness()
      void preflightBundledMadangdStartup()
        .then(() => {
          // Probe before deferred node-pty loading can crash this process.
          runMadangdNativePreflight()
          return main()
        })
        .catch(failStartup)
    }
  } catch (error) {
    failStartup(error)
  }
}
