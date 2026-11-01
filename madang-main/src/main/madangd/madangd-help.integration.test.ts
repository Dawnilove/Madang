import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runProcess } from '@orca/process-host'
import { MADANGD_LAUNCHER_FILENAME, MADANGD_SERVER_ENTRY_FILENAME } from '../../shared/madangd-artifacts'

let directory = ''
let launcher = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'madangd-help-'))
  launcher = join(directory, MADANGD_LAUNCHER_FILENAME)
  const builder = pathToFileURL(join(process.cwd(), 'config/scripts/madangd-entry-build.mjs')).href
  const built = await runProcess({
    program: process.execPath,
    args: [
      '--input-type=module',
      '-e',
      `import {buildMadangdEntry,buildMadangdLauncher} from ${JSON.stringify(builder)};` +
        `await buildMadangdEntry(${JSON.stringify(join(directory, MADANGD_SERVER_ENTRY_FILENAME))});` +
        `await buildMadangdLauncher(${JSON.stringify(launcher)});`
    ],
    env: { ...process.env, MADANG_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 60_000
  })
  expect(built.code, built.stderr).toBe(0)
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('real madangd executable help', () => {
  it.each([['--help'], ['-h'], ['--json', '--help'], ['--help', '--json']])(
    'prints usage to stdout and exits without creating a profile: %j',
    async (...argv) => {
      const dataRoot = join(directory, `absent-${argv.join('-')}`)
      const result = await runProcess({
        program: process.execPath,
        args: [launcher, ...argv],
        env: { ...process.env, MADANG_BACKGROUND_LAUNCH: '1', MADANG_USER_DATA: dataRoot },
        timeoutMs: 10_000
      })
      expect(result.code, result.stderr).toBe(0)
      expect(result.timedOut).toBe(false)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('Usage: madangd [options]')
      expect(result.stdout).toContain('--bind <ip>')
      expect(result.stdout).not.toContain('"type":"orca_server_ready"')
      await expect(readdir(dataRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('leaves an existing instance lock untouched', async () => {
    const dataRoot = join(directory, 'locked-profile')
    await mkdir(dataRoot)
    const lock = join(dataRoot, 'madangd.lock')
    const content = 'an existing instance owns this profile\n'
    await writeFile(lock, content)
    const result = await runProcess({
      program: process.execPath,
      args: [launcher, '--help'],
      env: { ...process.env, MADANG_BACKGROUND_LAUNCH: '1', MADANG_USER_DATA: dataRoot },
      timeoutMs: 10_000
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(await readFile(lock, 'utf8')).toBe(content)
    expect(await readdir(dataRoot)).toEqual(['madangd.lock'])
  })
})
