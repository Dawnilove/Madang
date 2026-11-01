/** Mirrors ORCA_REQUIRED_TEST_INPUTS_ENV in src/main/madangd/madangd-node-slot-fixture.ts. */
export const REQUIRED_TEST_INPUTS_ENV = 'MADANG_REQUIRED_TEST_INPUTS'

// Need the pinned Bun and the last Bun madangd slot beside the built Node slot (design D7).
export const CROSS_RUNTIME_TEST_PATHS = [
  'src/main/madangd/madangd-cross-runtime-daemon-adoption.integration.test.ts',
  'src/main/persistence/profile-state/profile-state-cross-runtime.integration.test.ts'
]

// Need the built desktop server template; CI runs them by path after build-madangd-template.mjs.
export const TEMPLATE_TEST_PATHS = [
  'src/main/madangd/madangd-packaged-structured-chat.integration.test.ts'
]

export function nodeServerTestPaths({
  artifact = false,
  crossRuntime = false,
  template = false
} = {}) {
  return [
    'src/main/persistence/profile-state',
    'src/main/persistence/loading-store/profile-state',
    'src/main/sqlite',
    'src/main/madangd/madangd-entry.test.ts',
    'src/main/madangd/madangd-push-startup.test.ts',
    // The madangd server's identity and stop path, which Windows SSH hosts rely on (W2).
    'src/main/madangd/madangd-instance-lock.test.ts',
    'src/main/madangd/madangd-process-start-time.test.ts',
    'src/main/madangd/madangd-stop-request-listener.test.ts',
    'src/main/madangd/madangd-managed-stop.test.ts',
    'src/main/madangd/madangd-managed-stop-cancellation.test.ts',
    'src/main/madangd/madangd-daemon-teardown-linux.test.ts',
    // The directory, not a prefix: its siblings are POSIX-host unit tests pr.yml already runs.
    'src/main/daemon/pty-subprocess/',
    'src/main/daemon/pty-subprocess-spawn-file-foreground.test.ts',
    'src/main/daemon/pty-subprocess-io-failure-native.test.ts',
    ...(artifact
      ? [
          'tests/e2e/daemon-running-work-probe.unit.test.ts',
          'src/shared/pty-running-work-probe.test.ts',
          'src/main/madangd/madangd-packaged-node-pty.integration.test.ts',
          'src/main/providers/agent-foreground-process-git-bash.win32.test.ts',
          'src/main/madangd/madangd-node-launcher.integration.test.ts',
          'src/main/madangd/madangd-cli-launcher.integration.test.ts',
          'src/main/madangd/madangd-cli-orchestration.integration.test.ts',
          'src/main/madangd/madangd-launcher-isolation.integration.test.ts',
          'src/main/madangd/madangd-stop-request-shutdown.integration.test.ts',
          'src/main/madangd/madangd-windows-conpty-breakaway.integration.test.ts',
          'src/main/madangd/madangd-serve-parity.integration.test.ts',
          'config/scripts/zip-extractor-command.test.mjs'
        ]
      : []),
    ...(crossRuntime ? CROSS_RUNTIME_TEST_PATHS : []),
    ...(template ? TEMPLATE_TEST_PATHS : [])
  ]
}
