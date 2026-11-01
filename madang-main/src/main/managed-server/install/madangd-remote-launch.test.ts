import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MADANGD_MANAGED_ACTIVATION_ROOT_ENV } from '../../../shared/madangd-managed-launch-env'

import {
  MADANGD_READINESS_FILENAME,
  MadangdRemoteLaunchUnsupportedError
} from './madangd-remote-host-support'
import {
  madangdLaunchCommand,
  madangdLivenessBlocksGc,
  madangdLivenessProvenExited,
  madangdLivenessProbeCommand,
  parseMadangdLiveness,
  parseMadangdReadinessOutput
} from './madangd-remote-launch'
import {
  madangdStopFreedTheHost,
  parseMadangdStopOutcome,
  stopMadangdCommand
} from './madangd-remote-process-control'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

const posix = getRemoteHostPlatform('linux-x64')
const windows = getRemoteHostPlatform('win32-x64')

const SPEC = {
  remoteInstallDir: '/home/u/.madang-remote/madangd-0.2.0+bb01',
  nodePath: '/usr/bin/node',
  fullVersion: '0.2.0+bb01',
  userDataDir: '/home/u/.madang',
  bindHost: '127.0.0.1',
  port: 7777,
  activationRoot: '/home/u/.madang-remote/.madangd-activation-transaction'
}

const READY_LINE = JSON.stringify({
  type: 'orca_server_ready',
  schemaVersion: 1,
  runtimeId: 'r1',
  boundEndpoint: 'ws://127.0.0.1:7777',
  advertisedEndpoint: null,
  managedWslCliReconciliation: 'settled',
  pairing: { available: false, reason: 'disabled_by_operator', guidance: 'n/a' },
  health: { buildHash: 'abc', terminalDaemon: { state: 'live' } }
})

describe('madangdLaunchCommand', () => {
  it('states the bind posture rather than inheriting the build default', () => {
    expect(madangdLaunchCommand(posix, SPEC)).toContain("--bind '127.0.0.1'")
  })

  it('truncates the readiness file, so a stale line cannot be activated on', () => {
    const command = madangdLaunchCommand(posix, SPEC)
    const cd = command.indexOf(`cd '${SPEC.remoteInstallDir}'`)
    const truncate = command.indexOf(`: > '${MADANGD_READINESS_FILENAME}'`)
    const launch = command.indexOf('nohup')
    expect(cd).toBeGreaterThan(-1)
    expect(truncate).toBeGreaterThan(cd)
    expect(truncate).toBeLessThan(launch)
  })

  it('exports the version and the shared data root the deploy decided on', () => {
    const command = madangdLaunchCommand(posix, SPEC)
    expect(command).toContain(`MADANG_VERSION '${SPEC.fullVersion}'`.replace(' ', '='))
    expect(command).toContain(`MADANG_USER_DATA='${SPEC.userDataDir}'`)
  })

  it('names the activation fence on every launch, which enables idle exit', () => {
    const command = madangdLaunchCommand(posix, SPEC)
    expect(command).toContain(`${MADANGD_MANAGED_ACTIVATION_ROOT_ENV}='${SPEC.activationRoot}'`)
    expect(command.indexOf(MADANGD_MANAGED_ACTIVATION_ROOT_ENV)).toBeLessThan(
      command.indexOf('nohup')
    )
  })

  it('declares the Windows refusal instead of emitting a command that cannot work', () => {
    expect(() => madangdLaunchCommand(windows, SPEC)).toThrow(MadangdRemoteLaunchUnsupportedError)
  })
})

describe('readiness parsing', () => {
  it('extracts the orca_server_ready payload', () => {
    const parsed = parseMadangdReadinessOutput(`${READY_LINE}\n`)
    expect(parsed).toMatchObject({ state: 'ready' })
    expect(parsed.state === 'ready' && parsed.readiness.boundEndpoint).toBe('ws://127.0.0.1:7777')
  })

  it('treats an empty or half-written file as pending, not as a failure', () => {
    expect(parseMadangdReadinessOutput('')).toEqual({ state: 'pending' })
    expect(parseMadangdReadinessOutput('{"type":"orca_serv')).toEqual({ state: 'pending' })
  })

  it('reports a complete JSON line that is not a readiness payload as malformed', () => {
    expect(parseMadangdReadinessOutput('{"type":"something_else"}')).toMatchObject({
      state: 'malformed'
    })
  })
})

describe('liveness', () => {
  it('reads the pid recorded in the version dir', () => {
    expect(madangdLivenessProbeCommand(posix, SPEC.remoteInstallDir)).toContain('.madangd-pid')
  })

  it.each([
    ['LIVE', 'LIVE', true],
    ['DEAD', 'DEAD', false],
    ['NEVER_LAUNCHED', 'NEVER_LAUNCHED', false],
    ['', 'UNKNOWN', true],
    ['garbage', 'UNKNOWN', true]
  ])('parses %s and blocks GC = %s', (output, expected, blocks) => {
    expect(parseMadangdLiveness(output)).toBe(expected)
    expect(madangdLivenessBlocksGc(parseMadangdLiveness(output))).toBe(blocks)
  })

  // Real host (win-lowspec): after a distro restart the probe's own shell took the recorded PID.
  describe.skipIf(process.platform === 'win32')(
    'a recorded PID after a restart (real shell)',
    () => {
      const probeIn = (script: string): string =>
        spawnSync('sh', ['-c', script], { encoding: 'utf8' }).stdout

      async function withSlot(run: (slot: string, probe: string) => Promise<void>): Promise<void> {
        const slot = mkdtempSync(join(tmpdir(), 'madangd-liveness-'))
        try {
          await run(slot, madangdLivenessProbeCommand(posix, slot))
        } finally {
          rmSync(slot, { recursive: true, force: true })
        }
      }

      async function waitForArgs(pid: number | undefined, needle: string): Promise<void> {
        for (let i = 0; i < 100; i++) {
          const args = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' })
          if (args.stdout.includes(needle)) {
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        throw new Error(`process ${pid} never showed ${needle}`)
      }

      it('calls dead a PID held by the probe shell or the shell wrapping it', async () => {
        await withSlot(async (slot, probe) => {
          const own = probeIn(`echo $$ > '${slot}/.madangd-pid'; ${probe}`)
          expect(parseMadangdLiveness(own)).toBe('DEAD')
          // The trailing `:` stops dash and bash from exec'ing the inner shell into the outer's PID.
          const wrapped = probeIn(
            `echo $$ > '${slot}/.madangd-pid'; sh -c ${JSON.stringify(probe).replace(/\$/g, '\\$')}; :`
          )
          expect(parseMadangdLiveness(wrapped)).toBe('DEAD')
        })
      })

      it('keeps a live madangd, and the waiting shell of an older launcher, live', async () => {
        await withSlot(async (slot, probe) => {
          const entry = join(slot, 'madangd.js')
          writeFileSync(entry, 'setInterval(() => {}, 1000)\n')
          const madangd = spawn(process.execPath, [entry], { stdio: 'ignore' })
          // Before `exec` landed in the launcher, the recorded PID was a shell waiting on node.
          const waiting = spawn('sh', ['-c', `'${process.execPath}' '${entry}'; :`], {
            stdio: 'ignore',
            // Own process group, so cleanup also reaches the node the shell waits on.
            detached: true
          })
          try {
            await waitForArgs(madangd.pid, 'madangd.js')
            writeFileSync(join(slot, '.madangd-pid'), `${madangd.pid}\n`)
            expect(parseMadangdLiveness(probeIn(probe))).toBe('LIVE')
            await waitForArgs(waiting.pid, 'madangd.js')
            writeFileSync(join(slot, '.madangd-pid'), `${waiting.pid}\n`)
            expect(parseMadangdLiveness(probeIn(probe))).toBe('LIVE')
          } finally {
            madangd.kill()
            if (waiting.pid !== undefined) {
              process.kill(-waiting.pid, 'SIGKILL')
            }
          }
        })
      })
    }
  )

  it.each([
    ['DEAD', true],
    ['NEVER_LAUNCHED', true],
    ['LIVE', false],
    ['UNKNOWN', false]
  ] as const)('%s is proven exit = %s', (liveness, exited) => {
    expect(madangdLivenessProvenExited(liveness)).toBe(exited)
  })
})

describe('stopping a running madangd', () => {
  it('sends SIGTERM and never SIGKILL', () => {
    const command = stopMadangdCommand(posix, SPEC.remoteInstallDir, {
      waitSeconds: 20,
      nodePath: SPEC.nodePath
    })
    expect(command).toContain('kill -TERM')
    for (const kill of ['kill -9', 'kill -KILL', 'kill -SIGKILL', 'pkill']) {
      expect(command).not.toContain(kill)
    }
  })

  it.each([
    ['STOPPED', 'stopped', true],
    ['ALREADY_EXITED', 'already-exited', true],
    ['NO_PID', 'no-pid', false],
    ['STILL_RUNNING', 'still-running', false],
    ['SIGNAL_FAILED', 'signal-failed', false],
    ['UNKNOWN', 'unknown', false],
    ['SIGNALED\nUNKNOWN', 'unconfirmed', false],
    ['', 'unconfirmed', false]
  ])('parses %s and frees the host = %s', (output, expected, frees) => {
    expect(parseMadangdStopOutcome(output)).toBe(expected)
    expect(madangdStopFreedTheHost(parseMadangdStopOutcome(output))).toBe(frees)
  })
})
