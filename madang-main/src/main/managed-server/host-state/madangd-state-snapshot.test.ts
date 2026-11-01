import { describe, expect, it } from 'vitest'

import {
  captureMadangdStateSnapshotCommand,
  clearMadangdStateSnapshotMembersCommand,
  compareMadangdStateSnapshotCommand,
  madangdSnapshotDirName,
  parseMadangdSnapshotCapture,
  parseMadangdSnapshotPresence,
  parseMadangdSnapshotRestore,
  probeMadangdStateSnapshotCommand,
  restoreMadangdStateSnapshotCommand,
  MADANGD_STATE_MUTATION_DEADLINE_SECONDS
} from './madangd-state-snapshot'
import { newestStateMtimeCommand, parseNewestStateMtimeSeconds } from './madangd-state-newest-mtime'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { MADANGD_SNAPSHOT_EXCLUDED, MADANGD_SNAPSHOT_MEMBERS } from './madangd-state-snapshot-members'

const posix = getRemoteHostPlatform('linux-x64')
const windows = getRemoteHostPlatform('win32-x64')
const ROOT = '/home/u/.madang'
const SNAP = '/home/u/.madang-remote/madangd-state-snapshots/pre-0.2.0+bb01-1000'
const BASE = '/home/u/.madang-remote'

function memberLists(command: string): string[] {
  return [...command.matchAll(/for m in ([^;]+);/g)].map((match) => match[1])
}

function innerScript(command: string): string {
  return command.replaceAll(`'\\''`, `'`)
}

describe('capturing the pre-activation snapshot', () => {
  it('captures the profile state a rollback needs', () => {
    expect(memberLists(captureMadangdStateSnapshotCommand(posix, ROOT, SNAP, BASE))).toEqual([
      MADANGD_SNAPSHOT_MEMBERS.join(' ')
    ])
  })

  // Restoring daemon sockets, PID or auth tokens would break adoption of terminals surviving restart.
  it.each(MADANGD_SNAPSHOT_EXCLUDED)('never captures, removes or restores over %s', (excluded) => {
    const commands = [
      captureMadangdStateSnapshotCommand(posix, ROOT, SNAP, BASE),
      restoreMadangdStateSnapshotCommand(posix, ROOT, SNAP, BASE),
      clearMadangdStateSnapshotMembersCommand(posix, ROOT, BASE),
      compareMadangdStateSnapshotCommand(posix, ROOT, SNAP, BASE)
    ]
    for (const list of commands.flatMap(memberLists)) {
      expect(list.split(' ')).not.toContain(excluded)
    }
  })

  it('writes the archive under a temp name and renames, so a killed deploy leaves no torn tar', () => {
    const command = captureMadangdStateSnapshotCommand(posix, ROOT, SNAP, BASE)
    expect(command).toContain('.partial')
    expect(command.indexOf('tar -C')).toBeLessThan(command.indexOf('mv '))
  })

  it.each([
    ['CAPTURED', 'captured'],
    ['EMPTY', 'empty'],
    ['tar: broken', 'failed'],
    ['', 'failed'],
    // Gateways may append shell job notices after a valid verdict (#30491).
    ['CAPTURED\r\nsh: line 1:  2468 Terminated   ( while sleep 60 ... )\n', 'captured'],
    ['FAILED\nCAPTURED-looking noise', 'failed']
  ])('parses %j as %s', (output, expected) => {
    expect(parseMadangdSnapshotCapture(output)).toBe(expected)
  })

  it('keys the snapshot dir on both version and time, so a retry cannot overwrite one', () => {
    expect(madangdSnapshotDirName('0.2.0+bb01', 1000)).not.toBe(
      madangdSnapshotDirName('0.2.0+bb01', 2000)
    )
  })
})

describe('the host-side guard around every state mutation', () => {
  it.each([
    ['capture', () => captureMadangdStateSnapshotCommand(posix, ROOT, SNAP, BASE)],
    ['restore', () => restoreMadangdStateSnapshotCommand(posix, ROOT, SNAP, BASE)],
    ['clear', () => clearMadangdStateSnapshotMembersCommand(posix, ROOT, BASE)]
  ])('%s runs under the host lock and a host-enforced deadline', (_label, build) => {
    const command = build()
    expect(command).toContain(
      `orca_deadline="timeout -s KILL ${MADANGD_STATE_MUTATION_DEADLINE_SECONDS}"`
    )
    expect(command).toContain('orca_state_group $orca_deadline sh -c')
    expect(innerScript(command)).toContain(`lock='${BASE}/madangd-state-mutation.lock'`)
    expect(command).toContain('echo STATE_MUTATION_DEADLINE')
  })
})

describe('restoring the snapshot', () => {
  it('proves the archive extracts before clearing the live members', () => {
    const command = innerScript(restoreMadangdStateSnapshotCommand(posix, ROOT, SNAP, BASE))
    const extract = command.indexOf('tar -C "$stage" -xf "$archive"')
    expect(extract).toBeGreaterThan(-1)
    expect(extract).toBeLessThan(command.indexOf('rm -rf "$root/$m"'))
  })

  it('reports a missing archive instead of extracting nothing and claiming success', () => {
    expect(restoreMadangdStateSnapshotCommand(posix, ROOT, SNAP, BASE)).toContain('echo MISSING')
    expect(parseMadangdSnapshotRestore('MISSING')).toBe('missing')
    expect(parseMadangdSnapshotRestore('RESTORED')).toBe('restored')
    expect(parseMadangdSnapshotRestore('FAILED')).toBe('failed')
    expect(parseMadangdSnapshotRestore('RESTORED\nsh: line 1: 13 Terminated')).toBe('restored')
  })

  it.each([
    ['PRESENT', 'present'],
    ['ABSENT', 'absent'],
    ['', 'unverifiable'],
    ['bash: tar: command not found', 'unverifiable']
  ])('reads snapshot presence %j as %s, never treating silence as absence', (out, expected) => {
    expect(parseMadangdSnapshotPresence(out)).toBe(expected)
  })
})

describe('detecting writes since activation', () => {
  it.each([
    ['1700000000', 1_700_000_000],
    ['UNKNOWN', null],
    ['', null]
  ])('parses %s', (output, expected) => {
    expect(parseNewestStateMtimeSeconds(output)).toBe(expected)
  })

  it('looks at the same members the snapshot covers', () => {
    const command = newestStateMtimeCommand(posix, ROOT, BASE)
    for (const member of MADANGD_SNAPSHOT_MEMBERS) {
      expect(command).toContain(`'${member}'`)
    }
  })
})

describe('Windows hosts', () => {
  const BASE = 'C:/Users/u/.madang-remote'
  it.each([
    [
      'capture',
      'snapshot-capture',
      (base: string) => captureMadangdStateSnapshotCommand(windows, ROOT, SNAP, base)
    ],
    [
      'restore',
      'snapshot-restore',
      (base: string) => restoreMadangdStateSnapshotCommand(windows, ROOT, SNAP, base)
    ],
    [
      'clear',
      'snapshot-clear',
      (base: string) => clearMadangdStateSnapshotMembersCommand(windows, ROOT, base)
    ],
    [
      'presence',
      'snapshot-probe',
      (base: string) => probeMadangdStateSnapshotCommand(windows, SNAP, base)
    ],
    [
      'compare',
      'snapshot-compare',
      (base: string) => compareMadangdStateSnapshotCommand(windows, ROOT, SNAP, base)
    ],
    ['mtime', 'state-newest-mtime', (base: string) => newestStateMtimeCommand(windows, ROOT, base)]
  ])('%s runs the host script op %s with node.exe, never a POSIX command', (_label, op, build) => {
    const command = build(BASE)
    expect(command).toContain(` ${op} `)
    expect(command).toMatch(/^C:\\Users\\u\\\.madang-remote\\runtimes\\node-[0-9a-f]+\\node\.exe /u)
    expect(command).not.toMatch(/tar |find |diff |EncodedCommand|powershell/u)
  })
})
