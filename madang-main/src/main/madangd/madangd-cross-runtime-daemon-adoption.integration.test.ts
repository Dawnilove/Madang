// Test live terminal survival across Bun/Node slot switches using real deploy commands and one data root.
import type * as ExecCommandModule from '../ssh/remote-exec/remote-exec-command'
import { build } from 'esbuild'
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { runProcess } from '@orca/process-host'
import { NODE_RUNTIME_ASSETS } from '../../shared/node-runtime-pin'
import {
  MADANGD_BUILD_TARGET_FILENAME,
  MADANGD_INSTALL_COMPLETE_FILENAME,
  MADANGD_NODE_RUNTIME_MARKER_FILENAME,
  MADANGD_VERSION_FILENAME,
  madangdBunRuntimeFilename,
  madangdNodeRuntimeRelativePath
} from '../../shared/madangd-artifacts'
import {
  killAndAwaitExit,
  killProfileDaemons,
  removeTestRoot
} from './madangd-daemon-teardown-fixture'
import { PROTOCOL_VERSION } from '../daemon/types'
import type { ServeReadiness } from '../server/serve-readiness'
import {
  getOrcaProfileIndexPath,
  getOrcaProfileStateDatabaseFile
} from '../madang-profiles/profile-storage-paths'
import {
  emptyMadangdActivationRecord,
  madangdGcPinnedDirNames
} from '../managed-server/activation/madangd-activation-record'
import { gcOldMadangdVersions } from '../managed-server/install/madangd-remote-gc'
import {
  MADANGD_PID_FILENAME,
  MADANGD_READINESS_FILENAME
} from '../managed-server/install/madangd-remote-host-support'
import {
  madangdLaunchCommand,
  parseMadangdReadinessOutput
} from '../managed-server/install/madangd-remote-launch'
import {
  parseMadangdStopOutcome,
  stopMadangdCommand
} from '../managed-server/install/madangd-remote-process-control'
import { RELAY_REMOTE_DIR } from '../ssh/remote-exec/remote-frame-protocol'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import {
  skipForMissingInputs,
  hostServerTarget,
  locatePinnedNodeForTests
} from './madangd-node-slot-fixture'
import { unusedSshConnection } from '../ssh/unused-host-transport.test-fixture'

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))
vi.mock('../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: execMock
}))

type Runtime = 'Bun' | 'Node'
type Slot = { runtime: Runtime; dir: string; version: string }
type ClientResult = { pid: number; isReattach: boolean; output: boolean }

const pinnedNode = locatePinnedNodeForTests()
const bunSlotSource = process.env.MADANG_BUN_MADANGD_SLOT
  ? resolve(process.env.MADANG_BUN_MADANGD_SLOT)
  : null
const nodeSlotSource = resolve('out/madangd')
const posix = process.platform !== 'win32'
const host = getRemoteHostPlatform(
  process.platform === 'darwin'
    ? process.arch === 'arm64'
      ? 'darwin-arm64'
      : 'darwin-x64'
    : process.arch === 'arm64'
      ? 'linux-arm64'
      : 'linux-x64'
)
const missing = [
  ...(pinnedNode ? [] : ['the pinned Node (MADANG_PINNED_NODE or out/runtimes)']),
  ...(existsSync(join(nodeSlotSource, MADANGD_NODE_RUNTIME_MARKER_FILENAME))
    ? []
    : ['a Node madangd slot in out/madangd (pnpm build:madangd)']),
  ...(bunSlotSource &&
  existsSync(join(bunSlotSource, MADANGD_BUILD_TARGET_FILENAME)) &&
  existsSync(join(bunSlotSource, madangdBunRuntimeFilename(process.platform)))
    ? []
    : ['a Bun madangd slot at MADANG_BUN_MADANGD_SLOT (build-madangd-bun.mjs --out-dir)'])
]

let root = ''
let client = ''
let backupDriver = ''
let bunProtocolVersion = 0
const launched = new Set<number>()

/** Clear Vitest markers so daemon-entry starts its server. */
function hostEnv(): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'NODE_ENV')
    ),
    MADANG_BACKGROUND_LAUNCH: '1',
    MADANG_DISABLE_MACOS_LOGIN_SHELL: '1'
  }
}

function shell(command: string, timeoutMs = 60_000): Promise<string> {
  return runProcess({
    program: '/bin/sh',
    args: ['-c', command],
    env: hostEnv(),
    timeoutMs
  }).then((result) => {
    if (result.code !== 0) {
      throw new Error(`shell exited ${result.code}: ${result.stderr}\n${command}`)
    }
    return result.stdout
  })
}

function linkOrCopy(from: string, to: string): void {
  try {
    linkSync(from, to)
  } catch {
    copyFileSync(from, to)
  }
}

function installTree(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      installTree(from, to)
    } else {
      linkOrCopy(from, to)
    }
  }
}

function installSlot(caseRoot: string, runtime: Runtime, source: string): Slot {
  const version = readFileSync(join(source, MADANGD_VERSION_FILENAME), 'utf8').trim()
  const dir = join(caseRoot, RELAY_REMOTE_DIR, `madangd-${version}`)
  installTree(source, dir)
  writeFileSync(join(dir, MADANGD_INSTALL_COMPLETE_FILENAME), '')
  return { runtime, dir, version }
}

function installSlots(caseRoot: string): { slots: Record<Runtime, Slot>; nodeRuntime: string } {
  const slots = {
    Bun: installSlot(caseRoot, 'Bun', bunSlotSource!),
    Node: installSlot(caseRoot, 'Node', nodeSlotSource)
  }
  const target = hostServerTarget()
  const nodeRuntime = join(
    slots.Node.dir,
    ...madangdNodeRuntimeRelativePath(target, NODE_RUNTIME_ASSETS[target].executableSha256)
  )
  mkdirSync(join(nodeRuntime, '..'), { recursive: true })
  linkOrCopy(realpathSync(pinnedNode!), nodeRuntime)
  return { slots, nodeRuntime: resolve(nodeRuntime) }
}

async function launch(slot: Slot, userDataDir: string): Promise<ServeReadiness> {
  const pid = Number(
    (
      await shell(
        madangdLaunchCommand(host, {
          remoteInstallDir: slot.dir,
          nodePath: pinnedNode!,
          fullVersion: slot.version,
          userDataDir,
          bindHost: '127.0.0.1',
          port: 0,
          activationRoot: join(userDataDir, '.madangd-activation-transaction')
        })
      )
    ).trim()
  )
  launched.add(pid)
  let readiness: ServeReadiness | null = null
  await vi.waitFor(
    () => {
      const parsed = parseMadangdReadinessOutput(
        readFileSync(join(slot.dir, MADANGD_READINESS_FILENAME), 'utf8')
      )
      if (parsed.state !== 'ready') {
        const log = existsSync(join(slot.dir, 'madangd.log'))
          ? readFileSync(join(slot.dir, 'madangd.log'), 'utf8')
          : ''
        throw new Error(`${slot.runtime} madangd not ready (${parsed.state}): ${log.slice(-2000)}`)
      }
      readiness = parsed.readiness
    },
    { timeout: 90_000, interval: 250 }
  )
  return readiness!
}

async function stop(slot: Slot): Promise<void> {
  const outcome = parseMadangdStopOutcome(
    await shell(stopMadangdCommand(host, slot.dir, { waitSeconds: 30, nodePath: pinnedNode! }))
  )
  expect(outcome, `${slot.runtime} madangd stop`).toBe('stopped')
}

async function daemonClient(
  op: 'create' | 'attach' | 'kill',
  userDataDir: string,
  sessionId: string,
  marker: string
): Promise<ClientResult> {
  const result = await runProcess({
    program: pinnedNode!,
    args: [client, op, join(userDataDir, 'daemon'), sessionId, marker, root],
    env: hostEnv(),
    timeoutMs: 30_000
  })
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '')
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function processCommand(pid: number): Promise<string> {
  return (await shell(`ps -o command= -p ${pid}`)).trim()
}

async function backUpProfile(slot: Slot, runtime: string, userDataDir: string): Promise<void> {
  const index = JSON.parse(readFileSync(getOrcaProfileIndexPath(userDataDir), 'utf8'))
  const profileId = String(index.activeProfileId)
  const result = await runProcess({
    program: runtime,
    args: [
      backupDriver,
      join(slot.dir, 'profile-state-backup-worker-entry.js'),
      getOrcaProfileStateDatabaseFile(profileId, userDataDir),
      profileId,
      join(userDataDir, `backup-by-${slot.runtime}.db`)
    ],
    env: hostEnv(),
    timeoutMs: 60_000
  })
  expect(result.code, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '')).toEqual({ ok: true })
}

async function killLaunched(): Promise<void> {
  const pids = [...launched]
  launched.clear()
  await killAndAwaitExit(pids)
}

async function probeBunDaemonProtocol(): Promise<number> {
  const probeRoot = mkdtempSync(join(root, 'bun-probe-'))
  const slot = installSlot(probeRoot, 'Bun', bunSlotSource!)
  const userDataDir = join(probeRoot, 'data')
  try {
    const daemon = (await launch(slot, userDataDir)).health!.terminalDaemon
    expect(daemon).toMatchObject({ state: 'live', protocolVersion: expect.any(Number) })
    return daemon.protocolVersion!
  } finally {
    await stop(slot).catch(() => {})
    await killLaunched()
    // Failed launches can still leave a daemon; use its persistent PID record.
    await killProfileDaemons(userDataDir)
  }
}

const skip = skipForMissingInputs('cross-runtime', posix ? missing : [])

describe.skipIf(skip || !posix)('a live terminal across the Bun and Node madangd runtimes', () => {
  beforeAll(async () => {
    // Keep macOS socket paths below the 104-byte limit.
    root = realpathSync(mkdtempSync('/tmp/orca-xrt-'))
    client = join(root, 'daemon-client.cjs')
    backupDriver = join(root, 'backup-driver.cjs')
    execMock.mockImplementation(async (_conn: unknown, command: string) => shell(command))
    writeFileSync(
      backupDriver,
      `const { Worker } = require('node:worker_threads')
const [workerPath, databasePath, profileId, targetPath] = process.argv.slice(2)
const worker = new Worker(workerPath, { workerData: { databasePath, profileId, targetPath } })
worker.on('message', (message) => console.log(JSON.stringify(message)))
worker.on('error', (error) => { console.error(error); process.exitCode = 1 })
`
    )
    await build({
      stdin: {
        contents: `
        import { DaemonPtyAdapter } from './src/main/daemon/daemon-pty-adapter'
        import { getDaemonPidPath, getDaemonSocketPath, getDaemonTokenPath } from './src/main/daemon/daemon-spawner'
        import { setAppEnvironment } from './src/shared/app-environment'
        const [op, runtimeDir, sessionId, marker, cwd] = process.argv.slice(2)
        setAppEnvironment({
          getPath: () => cwd, getAppPath: () => cwd, getVersion: () => 'test', isPackaged: () => true,
          onWillQuit() {}, exit: code => process.exit(code), getAppMetrics: () => []
        })
        const adapter = new DaemonPtyAdapter({
          socketPath: getDaemonSocketPath(runtimeDir), tokenPath: getDaemonTokenPath(runtimeDir),
          pidPath: getDaemonPidPath(runtimeDir), profileScope: runtimeDir, runtimeDir
        })
        let output = ''
        adapter.onData(event => { if (event.id === sessionId) output += event.data })
        const deadline = setTimeout(() => { console.error('timed out; output: ' + output); process.exit(98) }, 20_000)
        ;(async () => {
          const spawned = await adapter.spawn(op === 'create'
            ? { sessionId, cols: 80, rows: 24, cwd, shellOverride: '/bin/sh' }
            : { sessionId, cols: 80, rows: 24 })
          if (op === 'kill') {
            await adapter.shutdown(spawned.id, { immediate: true })
          } else {
            // The echoed command line holds the format, never the expanded marker.
            adapter.write(spawned.id, "printf 'MADANG_XRT_%s\\\\n' " + marker + "\\r")
            while (!output.includes('MADANG_XRT_' + marker)) await new Promise(r => setTimeout(r, 50))
          }
          clearTimeout(deadline)
          await adapter.disconnectOnly()
          console.log(JSON.stringify({ pid: spawned.pid, isReattach: spawned.isReattach === true, output: output.includes('MADANG_XRT_' + marker) }))
          process.exit(0)
        })().catch(error => { console.error(error); process.exit(1) })
      `,
        resolveDir: process.cwd(),
        loader: 'ts'
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      external: ['electron', 'node-pty', '@parcel/watcher', '*.node'],
      outfile: client,
      logLevel: 'silent'
    })
    bunProtocolVersion = await probeBunDaemonProtocol()
  }, 180_000)

  afterEach(killLaunched)

  afterAll(async () => {
    await removeTestRoot(root)
  })

  it.for([
    ['Bun', 'Node'],
    ['Node', 'Bun']
  ] as const)(
    '%s madangd hands its daemon and profile to the %s madangd',
    { timeout: 240_000 },
    async ([from, to], context) => {
      // Protocol-mismatched daemons cannot be adopted across updates.
      if (bunProtocolVersion !== PROTOCOL_VERSION) {
        context.skip(
          `the Bun madangd's daemon speaks protocol ${bunProtocolVersion}, this checkout ${PROTOCOL_VERSION}`
        )
      }
      const caseRoot = mkdtempSync(join(root, `${from}-${to}-`))
      const userDataDir = join(caseRoot, 'data')
      const { slots, nodeRuntime } = installSlots(caseRoot)
      const outgoing = slots[from]
      const incoming = slots[to]
      const sessionId = `xrt-${from}-${to}`
      let daemonPid: number | null = null
      try {
        const first = await launch(outgoing, userDataDir)
        const forked = first.health!.terminalDaemon
        expect(forked).toMatchObject({
          state: 'live',
          buildVersion: outgoing.version,
          entryPath: join(outgoing.dir, 'daemon-entry.js'),
          protocolVersion: PROTOCOL_VERSION
        })
        daemonPid = forked.pid!
        const runtimes = {
          Bun: join(slots.Bun.dir, madangdBunRuntimeFilename(process.platform)),
          Node: nodeRuntime
        }
        expect(await processCommand(daemonPid)).toContain(runtimes[from])

        const created = await daemonClient('create', userDataDir, sessionId, 'BEFORE')
        expect(created).toMatchObject({ isReattach: false, output: true })

        await stop(outgoing)
        expect(isAlive(daemonPid)).toBe(true)
        expect(isAlive(created.pid)).toBe(true)

        const second = await launch(incoming, userDataDir)
        expect(second.health!.terminalDaemon).toMatchObject({
          state: 'live',
          ownsFreshSessions: true,
          pid: daemonPid,
          buildVersion: outgoing.version,
          entryPath: join(outgoing.dir, 'daemon-entry.js'),
          protocolVersion: PROTOCOL_VERSION
        })
        expect(first.health!.profileStateAuthority?.classification).toBe('neither')
        expect(second.health!.profileStateAuthority).toMatchObject({
          backend: 'sqlite',
          migrated: false
        })
        expect(second.health!.profileStateAuthority?.classification).not.toBe('neither')

        const attached = await daemonClient('attach', userDataDir, sessionId, 'AFTER')
        expect(attached).toEqual({ pid: created.pid, isReattach: true, output: true })

        const stale = join(caseRoot, RELAY_REMOTE_DIR, 'madangd-0.0.1+dead')
        mkdirSync(stale)
        writeFileSync(join(stale, MADANGD_INSTALL_COMPLETE_FILENAME), '')
        writeFileSync(
          join(stale, MADANGD_PID_FILENAME),
          readFileSync(join(outgoing.dir, MADANGD_PID_FILENAME))
        )
        const record = { ...emptyMadangdActivationRecord(), active: incoming.version }
        expect(madangdGcPinnedDirNames(record)).not.toContain(`madangd-${outgoing.version}`)
        await gcOldMadangdVersions({
          conn: unusedSshConnection(),
          host,
          remoteHome: caseRoot,
          currentDirAbsPath: incoming.dir,
          record,
          liveDaemonVersion: second.health!.terminalDaemon.buildVersion
        })
        expect(existsSync(stale)).toBe(false)
        expect(existsSync(join(outgoing.dir, 'daemon-entry.js'))).toBe(true)

        await stop(incoming)
        await backUpProfile(incoming, runtimes[to], userDataDir)

        await daemonClient('kill', userDataDir, sessionId, '')
        await vi.waitFor(() => expect(isAlive(created.pid)).toBe(false), { timeout: 10_000 })
      } finally {
        if (daemonPid) {
          await killAndAwaitExit([daemonPid])
        }
      }
    }
  )
})
