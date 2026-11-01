import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import type { MadangdMachineHomeProbe } from './madangd-machine-home'
import type { MadangdHostTransport } from '../../ssh/madangd-host-transport'
import type { RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

// Local shell commands run with per-machine hostname and hardware identity shims.
const shell = vi.hoisted((): { env: NodeJS.ProcessEnv | undefined } => ({
  env: undefined
}))
vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => {
  const { runProcess } = await import('@orca/process-host')
  return {
    ...(await importOriginal<typeof ExecCommandModule>()),
    execCommand: async (conn: { env?: NodeJS.ProcessEnv }, command: string) => {
      const env = conn.env ?? shell.env
      const merged = env?.ORCA_TEST_MERGE_STDERR === '1'
      const result = await runProcess({
        program: '/bin/sh',
        args: ['-c', merged ? `{ ${command}\n} 2>&1` : command],
        env
      })
      if (result.code !== 0) {
        const { sshCommandExitError } = await import('../../ssh/remote-exec/remote-exec-command')
        throw sshCommandExitError(command, result.code ?? 1, result.stdout)
      }
      return result.stdout
    }
  }
})

const { resolveMadangdMachineHome } = await import('../install/madangd-remote-context')
const {
  decideMadangdMachineHome,
  madangdMachineIdentity,
  madangdMachineOwnershipUnresolvedMessage,
  parseMadangdMachineHomeProbe,
  MADANGD_MACHINE_CLAIM_FILENAME,
  MADANGD_MACHINE_HOMES_DIRNAME
} = await import('./madangd-machine-home')
const { MADANGD_MACHINE_CLAIM_ARBITER_DIRNAME } = await import('./madangd-machine-claim-command')
const { computeRemoteInstallDir } = await import('../install/remote-versioned-install')
const { MADANGD_INSTALL_MODEL } = await import('../install/remote-install-model')
const { madangdLivenessProbeCommand } = await import('../install/madangd-remote-launch')
const { MADANGD_PID_FILENAME } = await import('../install/madangd-remote-host-support')
const { execMadangdRemote } = await import('../install/madangd-remote-runtime-control')
const { getRemoteHostPlatform } = await import('../../ssh/ssh-remote-platform')
type Probe = MadangdMachineHomeProbe
type Host = RemoteHostPlatform

const linux = getRemoteHostPlatform('linux-x64')
const darwin = getRemoteHostPlatform('darwin-arm64')
const POSIX = process.platform !== 'win32'

let scratch: string
let home: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'madangd-machine-home-'))
  home = join(scratch, 'shared-home')
  mkdirSync(home)
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function uuidOf(name: string): string {
  const hex = Buffer.from(name.padEnd(16, '-')).toString('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function ioregOutput(name: string): string {
  return `+-o J316sAP  <class IOPlatformExpertDevice>\n    "IOPlatformUUID" = "${uuidOf(name).toUpperCase()}"\n`
}

type MachineOptions = {
  noHardLinks?: boolean
  /** Barrier both claim writers, then delay this machine's publication. */
  claimWriteDelay?: number
  /** Simulated df source distinguishes shared exports from local disks. */
  homeSource?: string
  availableKb?: number
  claimMoveError?: string
  /** Simulate stderr merged into stdout by an SSH gateway. */
  catStderrNoise?: string
}

/** Model macOS machines sharing one NFS home. */
function machine(name: string, hostname = name, options: MachineOptions = {}) {
  const bin = join(scratch, `bin-${name}-${hostname}`)
  mkdirSync(bin, { recursive: true })
  const tool = (tool: string, script: string): void => {
    writeFileSync(join(bin, tool), `#!/bin/sh\n${script}\n`)
    chmodSync(join(bin, tool), 0o755)
  }
  tool('uname', `echo ${hostname}`)
  tool('ioreg', `printf '%s' '${ioregOutput(name)}'`)
  // macOS has no kern.hostuuid OID; probe must use ioreg.
  tool('sysctl', `echo "sysctl: unknown oid '$2'" >&2; exit 1`)
  if (options.homeSource !== undefined || options.availableKb !== undefined) {
    tool(
      'df',
      `printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n%s 100 1 ${options.availableKb ?? 99} 1%% /home\\n' '${options.homeSource ?? '/dev/disk3s5'}'`
    )
  }
  if (options.claimMoveError !== undefined) {
    tool(
      'mv',
      [
        'for last; do :; done',
        `case "$last" in */${MADANGD_MACHINE_CLAIM_FILENAME}) echo "mv: ${options.claimMoveError}" >&2; exit 1;; esac`,
        'exec /bin/mv "$@"'
      ].join('\n')
    )
  }
  if (options.noHardLinks) {
    tool('ln', 'echo "ln: Operation not supported" >&2; exit 1')
  }
  if (options.claimWriteDelay !== undefined) {
    const barrier = join(scratch, 'claim-write-barrier')
    mkdirSync(barrier, { recursive: true })
    tool(
      'mv',
      [
        'for last; do :; done',
        `case "$last" in */${MADANGD_MACHINE_CLAIM_FILENAME})`,
        `  : > '${barrier}/'$$; i=0`,
        `  while [ "$(ls '${barrier}' | wc -l)" -lt 2 ] && [ $i -lt 40 ]; do sleep 0.05; i=$((i + 1)); done`,
        `  sleep ${options.claimWriteDelay};;`,
        'esac',
        'exec /bin/mv "$@"'
      ].join('\n')
    )
  }
  if (options.catStderrNoise !== undefined) {
    // Inject noise around the claim, which ends without a newline.
    tool(
      'cat',
      `echo '${options.catStderrNoise}' >&2; /bin/cat "$@"; s=$?; printf '%s' '${options.catStderrNoise}' >&2; exit $s`
    )
  }
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    ORCA_TEST_MERGE_STDERR: options.catStderrNoise === undefined ? '0' : '1'
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked execCommand reads only env.
  const conn = {
    env
  } as unknown as MadangdHostTransport
  return { conn, host: darwin, env }
}

function loginHomeResult() {
  return { loginHome: home, madangdHome: home, userDataDir: join(home, '.madang') }
}

function claimPath(): string {
  return join(home, '.madang-remote', MADANGD_MACHINE_CLAIM_FILENAME)
}

function legacyOwner(name: string, machineIdentity: string | null = uuidOf(name)): void {
  const dir = join(home, '.madang', '.profile-state-access', 'participants', 'token')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'token.owner'),
    JSON.stringify({
      token: 'token',
      pid: 4242,
      host: name,
      platform: 'darwin',
      ...(machineIdentity === null ? {} : { machineIdentity })
    })
  )
}

describe.runIf(POSIX)('resolveMadangdMachineHome on a home several machines share', () => {
  it('gives the first machine the login home and every other machine its own', async () => {
    const a = machine('node-a')
    const b = machine('node-b')

    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
    const bHome = await resolveMadangdMachineHome(b, true)
    expect(bHome.loginHome).toBe(home)
    expect(bHome.madangdHome).toMatch(
      new RegExp(`^${home}/\\.madang-remote/${MADANGD_MACHINE_HOMES_DIRNAME}/[a-f0-9]{16}$`)
    )
    expect(statSync(bHome.madangdHome).mode & 0o777).toBe(0o700)
    // A shallow sibling path keeps runtime sockets within Unix length limits.
    expect(bHome.userDataDir).toMatch(new RegExp(`^${home}/\\.orca-[a-f0-9]{8}$`))

    expect(await resolveMadangdMachineHome(b, true)).toEqual(bHome)
    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
    expect(
      computeRemoteInstallDir(MADANGD_INSTALL_MODEL, bHome.madangdHome, '0.1.0+abc').startsWith(
        `${bHome.madangdHome}/.madang-remote/`
      )
    ).toBe(true)
  })

  it('never judges another machine’s PID: the second machine probes only its own slot', async () => {
    const a = machine('node-a')
    const b = machine('node-b')
    await resolveMadangdMachineHome(a, true)
    // Node-a's PID is not evidence about a process on node-b.
    const aSlot = computeRemoteInstallDir(MADANGD_INSTALL_MODEL, home, '0.1.0+abc')
    mkdirSync(aSlot, { recursive: true })
    writeFileSync(join(aSlot, MADANGD_PID_FILENAME), '999999\n')

    const { madangdHome } = await resolveMadangdMachineHome(b, true)
    const bSlot = computeRemoteInstallDir(MADANGD_INSTALL_MODEL, madangdHome, '0.1.0+abc')
    expect(bSlot).not.toBe(aSlot)
    const answer = await execMadangdRemote(b, madangdLivenessProbeCommand(darwin, bSlot))
    expect(answer.trim()).toBe('NEVER_LAUNCHED')
    expect(readFileSync(join(aSlot, MADANGD_PID_FILENAME), 'utf8')).toBe('999999\n')
  })

  it('upgrades an existing single-machine install in place', async () => {
    const a = machine('node-a')
    mkdirSync(join(home, '.madang-remote', 'madangd-0.1.0+abc'), {
      recursive: true
    })
    writeFileSync(join(home, '.madang-remote', 'madangd-active.json'), '{"schemaVersion":1}')
    mkdirSync(join(home, '.madang', 'profiles'), { recursive: true })
    legacyOwner('node-a')

    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
    expect(existsSync(claimPath())).toBe(true)
    expect(readFileSync(join(home, '.madang-remote', 'madangd-active.json'), 'utf8')).toBe(
      '{"schemaVersion":1}'
    )
    expect(existsSync(join(home, '.madang-remote', MADANGD_MACHINE_HOMES_DIRNAME))).toBe(false)
  })

  it('leaves an unclaimed install to the machine whose madangd holds its data root', async () => {
    const a = machine('node-a')
    const b = machine('node-b')
    legacyOwner('node-a')

    const bHome = await resolveMadangdMachineHome(b, true)
    expect(bHome.madangdHome).not.toBe(home)
    expect(existsSync(claimPath())).toBe(false)

    // Node-a exits; node-b must retain its own home instead of adopting that install.
    rmSync(join(home, '.madang'), { recursive: true })
    expect(await resolveMadangdMachineHome(b, true)).toEqual(bHome)
    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
  })

  it('lets exactly one of two machines claiming at once win', async () => {
    const a = machine('node-a')
    const b = machine('node-b')
    const homes = await Promise.all([
      resolveMadangdMachineHome(a, true),
      resolveMadangdMachineHome(b, true)
    ])
    expect(homes.filter((resolved) => resolved.madangdHome === home)).toHaveLength(1)
    expect(readdirNames(join(home, '.madang-remote'))).toEqual(
      [MADANGD_MACHINE_CLAIM_FILENAME, MADANGD_MACHINE_HOMES_DIRNAME].sort()
    )
  })

  it('keeps a Mac whose madangd predates macOS machine identity on its running install', async () => {
    const a = machine('node-a')
    mkdirSync(join(home, '.madang-remote', 'madangd-0.1.0+abc'), { recursive: true })
    // Legacy macOS ownership may omit machine identity.
    legacyOwner('node-a', null)
    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
  })

  it('never lets another Mac claim a live install whose owner recorded no machine identity', async () => {
    const nfs = { homeSource: 'filer:/export/home' }
    const b = machine('node-b', 'node-b', nfs)
    mkdirSync(join(home, '.madang-remote', 'madangd-0.1.0+abc'), { recursive: true })
    writeFileSync(join(home, '.madang-remote', 'madangd-active.json'), '{"schemaVersion":1}')
    // Legacy owner proves hostname only, not machine UUID.
    legacyOwner('node-a', null)

    await expect(resolveMadangdMachineHome(b, true)).rejects.toThrow(
      /recorded only a hostname[\s\S]*If node-b set it up/
    )
    expect(existsSync(claimPath())).toBe(false)
    // macOS hostname drift cannot establish that a legacy owner belongs to this machine.
    await expect(
      resolveMadangdMachineHome(machine('node-a', 'cafe-wifi', nfs), true)
    ).rejects.toThrow(/recorded only a hostname/)
    expect(await resolveMadangdMachineHome(machine('node-a', 'node-a', nfs), true)).toEqual(
      loginHomeResult()
    )
  })

  it('lets exactly one machine claim a home on a filesystem without hard links', async () => {
    const a = machine('node-a', 'node-a', { noHardLinks: true, claimWriteDelay: 0 })
    const b = machine('node-b', 'node-b', { noHardLinks: true, claimWriteDelay: 0.5 })
    const homes = await Promise.all([
      resolveMadangdMachineHome(a, true),
      resolveMadangdMachineHome(b, true)
    ])
    expect(homes.filter((resolved) => resolved.madangdHome === home)).toHaveLength(1)
    expect(readdirNames(join(home, '.madang-remote'))).toEqual(
      [
        MADANGD_MACHINE_CLAIM_ARBITER_DIRNAME,
        MADANGD_MACHINE_CLAIM_FILENAME,
        MADANGD_MACHINE_HOMES_DIRNAME
      ].sort()
    )
    expect(readdirNames(join(home, '.madang-remote', MADANGD_MACHINE_CLAIM_ARBITER_DIRNAME))).toEqual(
      [MADANGD_MACHINE_CLAIM_FILENAME]
    )
    expect(
      await Promise.all([resolveMadangdMachineHome(a, true), resolveMadangdMachineHome(b, true)])
    ).toEqual(homes)
  })

  it('lets exactly one of two machines replace an empty claim', async () => {
    mkdirSync(join(home, '.madang-remote'))
    writeFileSync(claimPath(), '')
    const homes = await Promise.all([
      resolveMadangdMachineHome(machine('node-a', 'node-a', { claimWriteDelay: 0 }), true),
      resolveMadangdMachineHome(machine('node-b', 'node-b', { claimWriteDelay: 0.5 }), true)
    ])
    expect(homes.filter((resolved) => resolved.madangdHome === home)).toHaveLength(1)
  })

  it('restores an emptied claim to the machine the arbiter already chose', async () => {
    const a = machine('node-a', 'node-a', { noHardLinks: true })
    const b = machine('node-b', 'node-b', { noHardLinks: true })
    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
    writeFileSync(claimPath(), '')
    expect((await resolveMadangdMachineHome(b, true)).madangdHome).not.toBe(home)
    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
  })

  it('keeps a renamed machine on its own install', async () => {
    expect(await resolveMadangdMachineHome(machine('node-a'), true)).toEqual(loginHomeResult())
    expect(await resolveMadangdMachineHome(machine('node-a', 'renamed'), true)).toEqual(
      loginHomeResult()
    )
  })

  it('replaces an empty claim a full disk left behind', async () => {
    mkdirSync(join(home, '.madang-remote'))
    writeFileSync(claimPath(), '')
    expect(await resolveMadangdMachineHome(machine('node-a'), true)).toEqual(loginHomeResult())
    expect(readFileSync(claimPath(), 'utf8')).toContain('machineKey')
  })

  it.skipIf(process.getuid?.() === 0)(
    'says why it could not write the claim, and leaves no partial behind (#30491)',
    async () => {
      const remote = mkdirp(home, '.madang-remote')
      chmodSync(remote, 0o500)
      try {
        await expect(resolveMadangdMachineHome(machine('node-a'), true)).rejects.toThrow(
          /^madangd could not claim this host's \.madang-remote: could not write a claim file in ~\/\.madang-remote: .*Permission denied.*belongs to this user and is writable/u
        )
        expect(readdirSync(remote)).toEqual([])
      } finally {
        chmodSync(remote, 0o700)
      }
    }
  )

  it('reads the claim through a gateway that merges shell noise into the answer (#30491)', async () => {
    const noisy = { catStderrNoise: 'bash: warning: setlocale: LC_ALL: cannot change locale' }
    expect(await resolveMadangdMachineHome(machine('node-a', 'node-a', noisy), true)).toEqual(
      loginHomeResult()
    )
    expect(
      (await resolveMadangdMachineHome(machine('node-b', 'node-b', noisy), true)).madangdHome
    ).not.toBe(home)
  })

  it('names a full disk when the claim cannot be moved into place (#30491)', async () => {
    const full = { noHardLinks: true, availableKb: 0, claimMoveError: 'No space left on device' }
    await expect(resolveMadangdMachineHome(machine('node-a', 'node-a', full), true)).rejects.toThrow(
      /could not move the claim into place at ~\/\.madang-remote\/madangd-machine\.json: mv: No space left on device\. The filesystem holding ~\/\.madang-remote has 0 KB free/u
    )
    expect(existsSync(claimPath())).toBe(false)
    expect(await resolveMadangdMachineHome(machine('node-a', 'node-a-freed'), true)).toEqual(
      loginHomeResult()
    )
  })

  it('refuses to guess when the claim cannot be read', async () => {
    mkdirSync(join(home, '.madang-remote'))
    writeFileSync(claimPath(), 'not json')
    await expect(resolveMadangdMachineHome(machine('node-a'), true)).rejects.toThrow(
      /cannot tell which machine owns/
    )
  })

  it('names no owner for a stopped pre-claim install on a shared home until the user does', async () => {
    const nfs = { homeSource: 'filer:/export/home' }
    const a = machine('node-a', 'node-a', nfs)
    const b = machine('node-b', 'node-b', nfs)
    // Clean shutdown removed the data-root owner but left an unattributed prior activation.
    writeFileSync(join(mkdirp(home, '.madang-remote'), 'madangd-active.json'), '{"schemaVersion":1}')
    mkdirp(home, '.madang', '.profile-state-access', 'participants')

    await expect(resolveMadangdMachineHome(b, true)).rejects.toThrow(/can't tell which machine/)
    expect(existsSync(claimPath())).toBe(false)
    expect(existsSync(join(home, '.madang-remote', MADANGD_MACHINE_HOMES_DIRNAME))).toBe(false)

    const message = await resolveMadangdMachineHome(a, true).then(
      () => '',
      (error: unknown) => String(error)
    )
    expect(message).toContain('If node-a set it up')
    await execMadangdRemote(a, message.slice(message.indexOf('reconnect: ') + 'reconnect: '.length))
    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
    expect((await resolveMadangdMachineHome(b, true)).madangdHome).not.toBe(home)
  })

  it('claims a shared home whose data root no madangd ever activated, and its fix runs anywhere', async () => {
    const a = machine('node-a', 'node-a', { homeSource: 'filer:/export/home' })
    // Profile use by a CLI need not imply any managed server install.
    mkdirp(home, '.madang', '.profile-state-access', 'participants')
    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())

    // Ownership repair must also work before ~/.madang-remote exists.
    rmSync(join(home, '.madang-remote'), { recursive: true })
    const fix = madangdMachineOwnershipUnresolvedMessage('a'.repeat(16), null)
    await execMadangdRemote(a, fix.slice(fix.indexOf('reconnect: ') + 'reconnect: '.length))
    expect(readFileSync(claimPath(), 'utf8')).toContain('a'.repeat(16))
  })

  it('claims a stopped pre-claim install on a local disk, which no other machine can share', async () => {
    const a = machine('node-a', 'node-a', { homeSource: '/dev/disk3s5' })
    writeFileSync(join(mkdirp(home, '.madang-remote'), 'madangd-active.json'), '{"schemaVersion":1}')
    expect(await resolveMadangdMachineHome(a, true)).toEqual(loginHomeResult())
  })

  it('keeps WSL on the login home without probing or claiming', async () => {
    expect(await resolveMadangdMachineHome(machine('node-a'), false)).toEqual(loginHomeResult())
    expect(existsSync(join(home, '.madang-remote'))).toBe(false)
  })
})

function mkdirp(...parts: string[]): string {
  const dir = join(...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

function readdirNames(dir: string): string[] {
  return readdirSync(dir).sort()
}

function probe(host: Host, overrides: Partial<Probe> = {}): Probe {
  return {
    loginHome: '/home/u',
    identity: madangdMachineIdentity(host, 'a'.repeat(32), 'node-a'),
    claim: { state: 'absent' },
    dataRootOwners: [],
    machineHomeKeys: [],
    loginHomeInstalled: false,
    homeOnLocalDisk: false,
    ...overrides
  }
}

describe('decideMadangdMachineHome', () => {
  it('keys Linux by machine-id alone, so a rename keeps the key', () => {
    const a = madangdMachineIdentity(linux, 'a'.repeat(32), 'node-a')
    expect(a?.key).toMatch(/^[a-f0-9]{16}$/)
    expect(madangdMachineIdentity(linux, 'a'.repeat(32), 'renamed')?.key).toBe(a?.key)
    expect(madangdMachineIdentity(linux, 'b'.repeat(32), 'node-a')?.key).not.toBe(a?.key)
    // Missing/invalid machine identity preserves the legacy login-home fallback.
    expect(madangdMachineIdentity(linux, '', 'node-a')).toBeNull()
    expect(madangdMachineIdentity(linux, '0'.repeat(32), 'node-a')).toBeNull()
  })

  it('keys macOS by hardware UUID alone, since its hostname follows the network', () => {
    const uuid = '12345678-1234-1234-1234-123456789ABC'
    const ioreg = `    "IOPlatformUUID" = "${uuid}"`
    expect(madangdMachineIdentity(darwin, ioreg, 'cafe-wifi')?.key).toBe(
      madangdMachineIdentity(darwin, ioreg, 'home-wifi')?.key
    )
    expect(madangdMachineIdentity(darwin, ioreg, 'cafe-wifi')?.machineIdentity).toBe(
      uuid.toLowerCase()
    )
    // Empty legacy macOS sysctl output is not machine identity.
    expect(madangdMachineIdentity(darwin, '', 'cafe-wifi')).toBeNull()
    const renamed = probe(darwin, {
      identity: madangdMachineIdentity(darwin, ioreg, 'cafe-wifi'),
      dataRootOwners: [{ host: 'home-wifi', machineIdentity: uuid.toLowerCase() }]
    })
    expect(decideMadangdMachineHome(renamed, darwin).kind).toBe('claim')
  })

  it('judges a data-root owner by machine-id, and by hostname only when it recorded none', () => {
    const other = probe(linux, {
      dataRootOwners: [{ host: 'node-a', machineIdentity: 'b'.repeat(32) }]
    })
    expect(decideMadangdMachineHome(other, linux).kind).toBe('machine-home')
    const renamed = probe(linux, {
      dataRootOwners: [{ host: 'old-name', machineIdentity: 'a'.repeat(32) }]
    })
    expect(decideMadangdMachineHome(renamed, linux).kind).toBe('claim')
    const unrecorded = probe(linux, {
      dataRootOwners: [{ host: 'node-b', machineIdentity: null }]
    })
    expect(decideMadangdMachineHome(unrecorded, linux).kind).toBe('machine-home')
  })

  it('claims no install whose owner names neither its machine nor a matching hostname', () => {
    const uuid = '12345678-1234-1234-1234-123456789abc'
    const mac = madangdMachineIdentity(darwin, `"IOPlatformUUID" = "${uuid}"`, 'mac-b')
    const otherMac = { host: 'mac-a', machineIdentity: null }
    expect(
      decideMadangdMachineHome(probe(darwin, { identity: mac, dataRootOwners: [otherMac] }), darwin)
    ).toEqual({ kind: 'unresolved', machineKey: mac?.key, cause: 'unattributed-owner' })
    expect(
      decideMadangdMachineHome(
        probe(darwin, { identity: mac, dataRootOwners: [otherMac], homeOnLocalDisk: true }),
        darwin
      ).kind
    ).toBe('claim')
    const nameless = probe(linux, { dataRootOwners: [{ host: null, machineIdentity: null }] })
    expect(decideMadangdMachineHome(nameless, linux).kind).toBe('unresolved')
  })

  it('reads a Linux home’s filesystem type before its df source', () => {
    const output = (installed: string, type: string, source: string): string =>
      [
        '/home/u',
        'a'.repeat(32),
        'node-a',
        'ABSENT',
        '',
        '',
        installed,
        type,
        `${source} 100 1 99 1% /home`
      ].join('\n__ORCA_MACHINE_HOME_SECTION__\n')
    const decide = (installed: string, type: string, source: string) =>
      decideMadangdMachineHome(
        parseMadangdMachineHomeProbe(output(installed, type, source), linux),
        linux
      )
    expect(decide('INSTALLED', 'nfs', '/dev/sda1').kind).toBe('unresolved')
    expect(decide('INSTALLED', 'ext2/ext3', 'filer:/export').kind).toBe('claim')
    // Old BusyBox may omit filesystem type; only device sources prove a local disk.
    expect(decide('INSTALLED', '', '/dev/sda1').kind).toBe('claim')
    expect(decide('INSTALLED', '', 'filer:/export').kind).toBe('unresolved')
    // Unused login homes have no prior server owner to strand.
    expect(decide('', 'nfs', 'filer:/export').kind).toBe('claim')
  })

  it('claims a stopped install only with evidence of whose it is', () => {
    const stopped = { loginHomeInstalled: true }
    expect(decideMadangdMachineHome(probe(linux, stopped), linux).kind).toBe('unresolved')
    expect(
      decideMadangdMachineHome(probe(linux, { ...stopped, homeOnLocalDisk: true }), linux).kind
    ).toBe('claim')
    const ownRunning = probe(linux, {
      ...stopped,
      dataRootOwners: [{ host: 'node-a', machineIdentity: 'a'.repeat(32) }]
    })
    expect(decideMadangdMachineHome(ownRunning, linux).kind).toBe('claim')
  })

  it('keeps the login home when the machine cannot be identified', () => {
    expect(decideMadangdMachineHome(probe(linux, { identity: null }), linux)).toEqual({
      kind: 'login-home'
    })
  })
})
