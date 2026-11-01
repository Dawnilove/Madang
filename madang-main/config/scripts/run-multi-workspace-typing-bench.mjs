// Run pnpm bench:multi-workspace-typing -- --panes 8 --rate-kbps 512 --keys 48 --label before-fix (see terminal-multi-workspace-typing-latency.spec.ts).
// Save distinct labels per build/config in tests/tools/benchmarks/results/multi-workspace-typing-*.json; compare totalMs/inputHalfMs/echoHalfMs percentiles.
import { spawn } from 'node:child_process'

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const knobByFlag = {
  '--visited-workspaces': 'MADANG_TYPING_BENCH_VISITED_WORKSPACES',
  '--load-workspaces': 'MADANG_TYPING_BENCH_LOAD_WORKSPACES',
  '--panes': 'MADANG_TYPING_BENCH_LOAD_PANES',
  '--rate-kbps': 'MADANG_TYPING_BENCH_RATE_KBPS',
  '--keys': 'MADANG_TYPING_BENCH_KEYS',
  '--cadence-ms': 'MADANG_TYPING_BENCH_KEY_CADENCE_MS',
  '--cpu-workers': 'MADANG_TYPING_BENCH_CPU_WORKERS',
  '--git-churn-repos': 'MADANG_TYPING_BENCH_GIT_CHURN_REPOS',
  '--git-churn-files': 'MADANG_TYPING_BENCH_GIT_CHURN_FILES',
  '--git-churn-concurrency': 'MADANG_TYPING_BENCH_GIT_CHURN_CONCURRENCY',
  '--codex-frame-rows': 'MADANG_TYPING_BENCH_CODEX_FRAME_ROWS',
  '--codex-split-delay-ms': 'MADANG_TYPING_BENCH_CODEX_SPLIT_DELAY_MS',
  '--worktrees': 'MADANG_TYPING_BENCH_METADATA_WORKTREES',
  '--repositories': 'MADANG_TYPING_BENCH_METADATA_REPOSITORIES',
  '--terminal-tabs': 'MADANG_TYPING_BENCH_METADATA_TERMINAL_TABS',
  '--unified-tabs': 'MADANG_TYPING_BENCH_METADATA_UNIFIED_TABS',
  '--sleepers': 'MADANG_TYPING_BENCH_METADATA_SLEEPERS',
  '--live-statuses': 'MADANG_TYPING_BENCH_METADATA_LIVE_STATUSES',
  '--panes-per-tab': 'MADANG_TYPING_BENCH_METADATA_PANES',
  '--status-history': 'MADANG_TYPING_BENCH_METADATA_STATUS_HISTORY',
  '--status-interval-ms': 'MADANG_TYPING_BENCH_METADATA_STATUS_INTERVAL_MS',
  '--agent-rows': 'MADANG_TYPING_BENCH_AGENT_ROWS',
  '--title-change-ms': 'MADANG_TYPING_BENCH_TITLE_CHANGE_MS',
  '--lifecycle-ms': 'MADANG_TYPING_BENCH_LIFECYCLE_MS',
  '--cpu-profile': 'MADANG_TYPING_BENCH_CPU_PROFILE',
  '--pty-metadata': 'MADANG_TYPING_BENCH_PTY_METADATA',
  '--metadata-status': 'MADANG_TYPING_BENCH_METADATA_STATUS',
  '--metadata-titles': 'MADANG_TYPING_BENCH_METADATA_TITLES',
  '--instrumentation': 'MADANG_TYPING_BENCH_INSTRUMENTATION',
  '--graph-probe': 'MADANG_TYPING_BENCH_GRAPH_PROBE',
  '--cpu-throttle': 'MADANG_TYPING_BENCH_CPU_THROTTLE',
  '--label': 'MADANG_TYPING_BENCH_LABEL'
}

const env = { ...process.env, MADANG_BACKGROUND_LAUNCH: '1', MADANG_TYPING_BENCH: '1' }
const passthroughArgs = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--') {
    continue
  }
  const knob = knobByFlag[argv[i]]
  if (knob) {
    env[knob] = argv[++i]
  } else {
    passthroughArgs.push(argv[i])
  }
}

const child = spawn(
  npxCommand,
  [
    'playwright',
    'test',
    'tests/e2e/terminal-multi-workspace-typing-latency.spec.ts',
    '--config',
    'tests/playwright.config.ts',
    '--project',
    'electron-headless',
    '--workers=1',
    ...passthroughArgs
  ],
  { stdio: 'inherit', env }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
