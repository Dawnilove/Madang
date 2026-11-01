// Compose the Node-host runtime; paired desktop pages work even without a local browser engine.
import process from 'node:process'
import { getAppEnvironment } from '../../shared/app-environment'
import { resolveMadangdInstallRoot, resolveUserDataPath } from './madangd-app-paths'
import { prepareMadangdCliLauncher } from './madangd-cli-launcher'
import { installMadangdHostAdapters, runMadangdQuitHandlers } from './madangd-host-adapters'
import { prepareMadangdSecretStoreAndMigrate } from './madangd-secret-store-startup'
import { describeMadangdBindExposure, resolveMadangdBindHost } from './madangd-bind-address'
import {
  flushMadangdProfileStoreForShutdown,
  installMadangdShutdownSignals,
  startMadangdWithHost,
  stopMadangdStructuredAgentSessions,
  type MadangdShutdownTrigger
} from './madangd-lifecycle'
import { MADANGD_USAGE, parseArgs, resolveMadangdWebClientRoot } from './madangd-command-arguments'
import type { MadangdRuntimeCleanup } from './madangd-runtime-lifetime'
import { installMadangdStopRequestListeners } from './madangd-stop-request-listener'
import { prepareMadangdManagedStop } from './madangd-managed-stop-admission'
import { bindMadangdStopTerminalAdmission } from './madangd-stop-terminal-admission'
import type { MadangdHandle, MadangdOptions } from './madangd-start-contract'
import { beginMadangdIdleExit, bindMadangdIdleShutdown } from './madangd-managed-idle-exit-host'
import { madangdAutomationsKeepHostBusy, startMadangdAutomations } from './madangd-automations'
import { changedAiVaultSearchSettings } from '../../shared/ai-vault-search-settings'
import type { AiVaultSearchSettings } from '../../shared/ai-vault-search-settings'
import { stampRuntimeSourceEnv } from '../../shared/runtime-source-env'
import { adoptWslHostLoginEnvironment } from './madangd-wsl-host-login-environment'
import { installMadangdProcessErrorGuards } from './madangd-process-error-guards'
import { madangdWsPortOptions } from './madangd-ws-port-policy'
import { MADANG_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import { placeUnshownLiveTerminalsBestEffort } from '../runtime/terminal/adoption/unshown-live-terminal-placement'

export { parseArgs }

let closeMadangdObservability = (): void => {}

/** Resolve after transport readiness publishes the desktop-compatible serve payload. */
export async function startMadangd(options: MadangdOptions = {}): Promise<MadangdHandle> {
  installMadangdHostAdapters()
  // Inherited terminal identity must not fence madangd’s CLI children to the launching desktop.
  stampRuntimeSourceEnv(process.env, null)
  const userDataPath = resolveUserDataPath()
  // Override inherited data roots so CLI-shared Codex homes resolve on this host.
  process.env.MADANG_USER_DATA_PATH = userDataPath
  const { readiness, instance, stop } = await startMadangdWithHost(
    userDataPath,
    (registerCleanup) => startMadangdRuntime(options, registerCleanup),
    () => {
      try {
        runMadangdQuitHandlers()
      } finally {
        // Close after quit handlers, including failed ones, so their spans reach disk.
        closeMadangdObservability()
        closeMadangdObservability = () => {}
      }
    }
  )
  const version = getAppEnvironment().getVersion()
  return { readiness, managedStop: { version, runtimeId: readiness.runtimeId, instance }, stop }
}

async function startMadangdRuntime(
  options: MadangdOptions,
  registerCleanup: (cleanup: MadangdRuntimeCleanup) => void
): Promise<Pick<MadangdHandle, 'readiness'>> {
  // Overlap login-shell probing with imports and store startup.
  const loginEnvironment = adoptWslHostLoginEnvironment().then(
    (names) => {
      if (names.length > 0) {
        console.info(`[madangd] adopted login-shell variables: ${names.join(', ')}`)
      }
    },
    (error: unknown) => console.warn('[madangd] could not adopt login-shell variables:', error)
  )
  const { OrcaRuntimeService } = await import('../runtime/madang-runtime')
  const { OrcaRuntimeRpcServer } = await import('../runtime/runtime-rpc')
  const { registerHeadlessPtyRuntime } = await import('../ipc/pty/register-headless-runtime')
  const { getLocalPtyProvider } = await import('../ipc/pty/provider/registry')
  const { installMadangdObservability } = await import('./madangd-observability')
  closeMadangdObservability = installMadangdObservability()
  const { ServeReadinessPublisher } = await import('../server/serve-readiness')
  const { servePublishMode } = await import('../server/serve-pairing-readiness')
  const { buildMadangdServeReadiness } = await import('./madangd-serve-readiness')
  const { createMadangdProfileStateStartup } = await import('./madangd-profile-state-startup')
  const { startMadangdDaemon, stopMadangdDaemon } = await import('./madangd-daemon-supervision')
  const { daemonOwnsFreshPersistentPtys } = await import('../daemon/daemon-provider-state')
  const { collectMadangdHealth } = await import('./madangd-health')
  const { agentHookServer } = await import('../agent-hooks/server')
  const { isAgentStatusHooksEnabled } = await import('../agent-hooks/managed-agent-hook-controls')
  const { agentHookRuntimeDeps } = await import('../agent-hooks/agent-hook-runtime-deps')
  const { installHookStatusSessionTabsRepublish } =
    await import('../agent-hooks/hook-status-session-tabs-republish')
  const { startMadangdManagedAgentHooks } = await import('./madangd-managed-agent-hooks')
  const { AgentStatusObservedPaneIdentities, AgentStatusObservedPaneIdentityCapture } =
    await import('../runtime/agent-status-observed-pane-identity')

  const { disposeWatcherProcessAndWait } =
    await import('../ipc/filesystem/watcher-process/parcel-watcher-process')

  let paneGridsForShutdown: { flushPaneGrids(): Promise<void> | null } | null = null
  let profileStoreForShutdown:
    | { flushFinalOrThrowAsync(): Promise<void>; freezeWritesAsync(): Promise<void> }
    | undefined
  let uninstallHookStatusRepublish = (): void => {}
  let uninstallObservedStatusIdentity = (): void => {}
  // Cleanups run in reverse: RPC, then recovery and watchers, then the final flush, then daemon.
  registerCleanup(() => agentHookServer.stop())
  registerCleanup(() => uninstallHookStatusRepublish())
  registerCleanup(() => uninstallObservedStatusIdentity())
  // Disconnect without killing daemon PTYs that must survive restart.
  registerCleanup(() => stopMadangdDaemon())
  registerCleanup(async () => {
    // A SQLite-backed madangd has no JSON mirror to absorb a debounced write after SIGTERM.
    if (profileStoreForShutdown) {
      await flushMadangdProfileStoreForShutdown(profileStoreForShutdown, paneGridsForShutdown)
    }
  })
  registerCleanup(stopMadangdStructuredAgentSessions)
  registerCleanup(() => disposeWatcherProcessAndWait())
  const { DesktopPushService } = await import('../runtime/push/desktop-push-service')
  const { resolvePushGatewayOrigin } = await import('../runtime/push/push-gateway-origin')

  const runtimeUserDataPath = getAppEnvironment().getPath('userData')
  const { startEventLoopDelayProbe } = await import('../diagnostics/event-loop-delay-probe')
  startEventLoopDelayProbe('madangd', runtimeUserDataPath)
  await prepareMadangdCliLauncher().catch((error: unknown) => {
    console.warn('[madangd] Could not prepare the profile CLI launcher', error)
  })
  const idleExitStartup = beginMadangdIdleExit(runtimeUserDataPath)
  // Only desktop requests reach a host's scanner, and it holds ~60 MB idle: retire it after a minute.
  const { setAiVaultServiceIdleTimeoutMs } =
    await import('../ai-vault/session-scanner-service-spawn')
  setAiVaultServiceIdleTimeoutMs(60_000)
  // Initialize sealing before Store load unseals protected settings.
  await prepareMadangdSecretStoreAndMigrate(runtimeUserDataPath)
  const { store: profileStore, authority: profileStateAuthority } =
    await createMadangdProfileStateStartup(runtimeUserDataPath)
  const observedPaneIdentities = new AgentStatusObservedPaneIdentities()
  const observedStatusCapture = new AgentStatusObservedPaneIdentityCapture(observedPaneIdentities)
  profileStoreForShutdown = profileStore
  uninstallObservedStatusIdentity = agentHookServer.subscribeEnrichedStatus((enriched) =>
    observedStatusCapture.observe(enriched)
  )
  // Subscribe before hooks start so early turns are counted.
  const { startMadangdStats } = await import('./madangd-stats')
  const stats = startMadangdStats(runtimeUserDataPath, agentHookServer, registerCleanup)
  await agentHookServer.start({
    env: 'production',
    userDataPath: runtimeUserDataPath,
    statusHooksEnabled: isAgentStatusHooksEnabled(profileStore.getSettings())
  })

  // Reconcile, daemon and runtime all consume this environment.
  await loginEnvironment
  startMadangdManagedAgentHooks(
    profileStore,
    (enabled) => agentHookServer.setStatusHooksEnabled(enabled),
    registerCleanup
  )

  // Install the daemon provider before PTY handlers can route their first call.
  await startMadangdDaemon()

  // Runtime constructor callbacks use this index only after it is installed.
  let sessionSearch: { apply(settings: AiVaultSearchSettings): void; dispose(): void } | null = null

  const { madangdCodexAccountHomes } = await import('./madangd-codex-account-homes')
  const codexAccountHomes = madangdCodexAccountHomes(
    () => profileStore.getSettings(),
    registerCleanup
  )

  const { createMadangdAccountServices } = await import('./madangd-account-services')
  const accountLaunch = createMadangdAccountServices({
    store: profileStore,
    setClaudeStatusLineListener: (listener) =>
      agentHookServer.setClaudeStatusLineListener(listener),
    registerCleanup,
    clientCodexHomes: codexAccountHomes
  })

  const { loadAgentSessionClaimSigner } =
    await import('../runtime/agent-session/ownership/agent-session-claim-identity')
  const runtime = new OrcaRuntimeService(profileStore, stats, {
    // Persistent signatures let restarted runtimes adopt PTYs owned before restart.
    agentSessionClaimSigner: loadAgentSessionClaimSigner(runtimeUserDataPath, runtimeUserDataPath),
    getAdditionalAiVaultCodexHomePaths: () => [
      ...codexAccountHomes.listSessionHomes(),
      ...(accountLaunch?.listCodexSessionHomes() ?? [])
    ],
    // WSL must retain desktop-pushed CODEX_HOME instead of host-selected resolvers.
    ...accountLaunch?.runtimeDeps,
    ...agentHookRuntimeDeps(agentHookServer, observedPaneIdentities, () =>
      profileStore.getSettings()
    ),
    // Resolve lazily because daemon swaps replace the provider after construction.
    getLocalProvider: () => getLocalPtyProvider(),
    // Read current daemon ownership; failed/degraded launch cannot claim fresh PTY persistence.
    canRecoverPersistentLocalPtys: () => daemonOwnsFreshPersistentPtys(),
    // Node hosts cannot promote into desktop windows; override the constructor’s openable default.
    getDesktopWindowStatus: () => 'blocked',
    // Unchanged settings would reconstruct a healthy search index; deduplicate before apply.
    applySessionSearchSettings: (before, after) => {
      const next = changedAiVaultSearchSettings(before, after)
      if (next) {
        sessionSearch?.apply(next)
      }
    }
  })
  paneGridsForShutdown = runtime

  accountLaunch?.attachToRuntime(runtime)
  const { installMadangdEmulatorBridge } = await import('./madangd-emulator-bridge')
  installMadangdEmulatorBridge(runtime, registerCleanup)

  // Restore prior desktop-pushed account selection before automations or CLI launches.
  const { restoreMadangdHostAccountLaunchEnv } = await import('./madangd-host-account-launch-env-store')
  restoreMadangdHostAccountLaunchEnv(runtime, runtimeUserDataPath)

  const { installMadangdSessionSearchService } = await import('./madangd-session-search')
  sessionSearch = await installMadangdSessionSearchService({
    userDataPath: runtimeUserDataPath,
    getSettings: () => profileStore.getSettings()
  })
  getAppEnvironment().onWillQuit(() => sessionSearch?.dispose())

  const { startAgentStateRulesLiveUpdates } =
    await import('../runtime/agent-state-rules/agent-state-rules-live-update')
  startAgentStateRulesLiveUpdates(profileStore, (rules) =>
    console.info(`[madangd] agent state rules ${rules.version} (${rules.source})`)
  )
  if (MADANG_LAYOUT_OWNER_IS_MAIN) {
    const { repairDuplicatePtyPanesOnStart } = await import('../runtime/moved-pane-owner-rekey')
    // Wait behind earlier writes and persist repair before reconciliation/RPC admission.
    await repairDuplicatePtyPanesOnStart(profileStore, runtime)
  }

  // Status changes must republish session.tabs to paired clients.
  uninstallHookStatusRepublish = installHookStatusSessionTabsRepublish(
    agentHookServer,
    () => runtime
  )
  registerCleanup(runtime.attachAgentStatusStore(agentHookServer))

  // Headless registration threads Store into persistence; account homes prefer client then host selection.
  // WSL has no host selection and keeps the desktop-prepared environment.
  await registerHeadlessPtyRuntime(
    runtime,
    async (target, launchEnv, context) =>
      (await codexAccountHomes.selectLaunchHome(target, launchEnv, context)) ??
      (accountLaunch ? accountLaunch.prepareCodexHome(target, launchEnv, context) : null),
    () => profileStore.getSettings(),
    accountLaunch?.prepareClaudeAuth,
    profileStore,
    accountLaunch?.prepareCodexSessionResume
  )

  // Recover browser/orchestration authority before clients attach to the runtime graph.
  runtime.rehydrateClientHostedBrowserPages()

  await runtime.refreshRestoredOrchestrationAuthority()
  await runtime.reconcileLegacyWorkerTerminals()
  if (MADANG_LAYOUT_OWNER_IS_MAIN) {
    await placeUnshownLiveTerminalsBestEffort(runtime)
  }
  runtime.agentTransitions.seedRestoredRows()
  void runtime.sidebarFacts?.reconcileSortStampTiers(getLocalPtyProvider())

  // Run after RPC stops; later dismissal records save synchronously until exit.
  registerCleanup(() => runtime.closeNotificationDismissals())
  // Stop recovery retries before final profile flush.
  registerCleanup(() => runtime.stopLegacyWorkerTerminalRecovery())

  // Recovery establishes terminal/dispatch identities before fencing observations.
  observedStatusCapture.attach(runtime)
  agentHookServer.setCliWriterExecutionMatcher(observedPaneIdentities, runtime)
  // First RPC clients must see a fully published graph.
  const { publishHeadlessRuntimeGraph } = await import('../runtime/headless-runtime-graph')
  publishHeadlessRuntimeGraph(runtime)
  // Only the runtime can identify running shells and install deferred migrated history.
  void runtime.installPendingMadangdMigrationShellHistory().catch((error: unknown) => {
    console.error('[madangd-migration] installing pending shell history failed:', error)
  })

  const bindHost = resolveMadangdBindHost(options.bind)
  bindMadangdStopTerminalAdmission(runtime.terminalUpdateAdmission)
  const rpc = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath: runtimeUserDataPath,
    enableWebSocket: true,
    // Pin operator exposure across restarts; pairing must not silently widen a loopback bind.
    pinnedBindHost: bindHost,
    webClientRoot: resolveMadangdWebClientRoot(options.webClientRoot),
    ...madangdWsPortOptions(options.port)
  })
  // Stop RPC before cleanup can tear down writers and runtime state.
  registerCleanup(() => rpc.stop())
  await rpc.start()
  startMadangdAutomations(runtime, profileStore, registerCleanup)
  const pushService = DesktopPushService.create({
    runtime,
    runtimeRpc: rpc,
    gatewayUrl: resolvePushGatewayOrigin(process.env, getAppEnvironment().isPackaged())
  })
  pushService?.start()
  getAppEnvironment().onWillQuit(() => pushService?.stop())
  console.error(`[madangd] ${describeMadangdBindExposure(bindHost)}`)

  const readiness = await buildMadangdServeReadiness({
    options,
    runtimeId: runtime.getRuntimeId(),
    rpc,
    collectHealth: () =>
      collectMadangdHealth(
        getAppEnvironment().getVersion(),
        profileStateAuthority,
        idleExitStartup.previousIdleStop
      )
  })

  await new ServeReadinessPublisher().publish(readiness, servePublishMode(options))

  await idleExitStartup.start({
    rpc,
    agentStates: () => agentHookServer.getStatusSnapshot(),
    hasStagedMigration: () => profileStore.hasStagedMadangdMigrationCatalog(),
    automationsBusy: () => madangdAutomationsKeepHostBusy(profileStore),
    emulatorsBusy: async () =>
      (await runtime.getEmulatorBridge()?.hasLiveManagedSessions()) ?? false,
    registerCleanup
  })
  return { readiness }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(MADANGD_USAGE)
    return
  }
  let shutdownTrigger: MadangdShutdownTrigger | null = null
  // Fire-and-forget startup work can reject before its first await completes.
  installMadangdProcessErrorGuards(() => shutdownTrigger)
  const startup = startMadangd(options)
  const requestShutdown = installMadangdShutdownSignals(async () => (await startup).stop())
  shutdownTrigger = requestShutdown
  const handle = await startup
  // Stop requests must name the runtime/instance established by startup.
  installMadangdStopRequestListeners(() => requestShutdown('stop request'), {
    installRoot: resolveMadangdInstallRoot(),
    managedStop: handle.managedStop,
    beforeManagedStop: prepareMadangdManagedStop
  })
  bindMadangdIdleShutdown(requestShutdown)
}
