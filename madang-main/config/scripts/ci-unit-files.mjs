import { globSync } from 'node:fs'
import { defaultExclude } from 'vitest/config'

// Why one constant: the cross-version-wire job runs this directory, so a new file there runs with no list to update.
export const CROSS_VERSION_WIRE_DIR = 'tests/e2e/cross-version-wire/'

export const UNIT_INCLUDE = [
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'config/scripts/**/*.test.ts',
  'config/scripts/**/*.test.mjs',
  'tests/tools/**/*.test.mjs',
  'tests/e2e/**/*.unit.test.ts'
]

export const UNIT_SETUP_FILES = [
  'config/scripts/vitest-real-agent-home-write-guard.ts',
  'config/scripts/vitest-bun-node-builtins.ts',
  'config/scripts/vitest-dom-setup.ts',
  'config/scripts/vitest-host-ports-setup.ts',
  'config/scripts/vitest-caller-identity-env-setup.ts',
  'config/scripts/vitest-windows-sqlite-close-before-rm.ts'
]

// POSIX-only suites (AppImage, macOS, Linux shims, /bin/sh); Linux and macOS jobs still run them.
export const UNIT_EXCLUDE_ON_WINDOWS = [
  'src/main/cli/appimage-copy-pre-extraction.test.ts',
  'src/main/cli/appimage-extracted-root.test.ts',
  'src/main/cli/appimage-extraction-pruning.test.ts',
  'src/main/cli/appimage-extraction-pruning-namespace.test.ts',
  'src/main/cli/appimage-generation-residency.test.ts',
  'src/main/cli/appimage-serve-preparation.test.ts',
  'src/main/cli/linux-bare-madang-dispatcher.test.ts',
  'src/main/cli/linux-terminal-madang-cli-shim.test.ts',
  'src/main/daemon/daemon-appimage-generation-launch.test.ts',
  'src/main/macos-tcc-reset.test.ts',
  'src/main/macos-tree-clone.test.ts',
  'src/main/window/macos-desktop-handoff.test.ts',
  'src/shared/darwin-process-table-inventory-drain.test.ts',
  'config/scripts/appimage-node-runtime.test.mjs',
  'src/main/agent-hooks/spool.test.ts',
  'src/main/managed-server/install/madangd-remote-shell-commands.integration.test.ts',
  'src/main/ssh/ssh-remote-node-resolution.test.ts'
]

export const UNIT_EXCLUDE = [
  ...defaultExclude,
  'src/main/daemon/repro-13767-shell-ready-marker-lost-to-exec.test.ts',
  'src/main/daemon/shell-ready.test.ts',
  'src/main/daemon/node-pty-fd-leak.test.ts',
  'src/main/providers/local-pty-shell-ready-zsh-launch-environment.test.ts',
  'src/main/providers/__tests__/shell-ready-framework-example.test.ts',
  'src/main/pty/omp-shell-wrapper-alias-safety.test.ts',
  'src/main/pty/omp-shell-wrapper.node-pty.test.ts',
  'src/main/shell-startup-feature-channel.test.ts',
  'src/main/zsh-deferred-startup-line-init.live-shell.test.ts',
  'src/main/terminal-history-fish-session.node-pty.test.ts',
  'src/main/zsh-scoped-histfile.live-shell.test.ts',
  'src/main/zsh-startup-hook-user-config-equivalence.live-shell.test.ts',
  'src/main/runtime/structured-session-cli-login-shell.live-shell.test.ts',
  'src/renderer/src/components/terminal-pane/fish-color-scheme-child-stdin.node-pty.test.ts',
  'src/shared/fish-query-reply-child-stdin.node-pty.test.ts',
  'src/shared/pty-reply-echo-shapes.node-pty.test.ts',
  'src/shared/startup-shell-portability.live-shell.test.ts',
  'src/shared/posix-command-path-lookup.test.ts',
  'tests/e2e/relay-region-compatibility.unit.test.ts',
  'tests/e2e/relay-region-correction.unit.test.ts',
  // Electron probes with in-process deadlines; the package job runs them serially.
  'src/main/browser/popup-origin-chrome.electron.test.ts',
  'src/main/browser/browser-link-materialization.electron.test.ts',
  'src/main/browser/browser-client-page-renderer-lifecycle.electron.test.ts',
  'src/main/browser/browser-route-tcp-egress.electron.test.ts',
  'src/main/browser/browser-route-webrtc-egress.electron.test.ts',
  'src/main/browser/browser-route-h3-egress.electron.test.ts',
  'src/main/browser/browser-route-dns-prefetch.electron.test.ts',
  'src/main/persistence/profile-state/profile-state-writer-stall.electron.test.ts',
  'src/main/browser/browser-popup-compatibility.electron.test.ts',
  'src/main/browser/browser-popup-adapter-compatibility.electron.test.ts',
  'src/main/browser/browser-popup-native-compatibility.electron.test.ts',
  'src/main/browser/browser-popup-background-compatibility.electron.test.ts',
  `${CROSS_VERSION_WIRE_DIR}**`
]

export function discoverUnitFiles(root = process.cwd()) {
  return globSync(UNIT_INCLUDE, { cwd: root, exclude: UNIT_EXCLUDE })
    .map((file) => file.replaceAll('\\', '/'))
    .sort()
}
