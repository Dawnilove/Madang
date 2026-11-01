// Child entries referenced by filename must ship beside madangd.js; bundling alone cannot include them.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { runProcessSync } from '@orca/process-host'
import { madangdArtifactFilenames } from '../../shared/madangd-artifacts'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const RUNTIME_ENTRY_FILENAME = /[A-Za-z0-9_.-]+-(?:entry|worker)\.c?js/g
// Known gaps must disappear as entries ship or references are removed; additions are not exemptions.
const KNOWN_UNSHIPPED_ENTRIES = new Set(['wsl-transcript-fs-process-entry.js'])
const directory = mkdtempSync(join(tmpdir(), 'madangd-runtime-entries-'))

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

function buildMadangdBundles(): string[] {
  const builder = pathToFileURL(join(REPO_ROOT, 'config/scripts/madangd-entry-build.mjs')).href
  const script = `
    import { build } from 'esbuild'
    import { join } from 'node:path'
    import * as entries from ${JSON.stringify(builder)}
    const out = ${JSON.stringify(directory)}
    await entries.buildMadangdEntry(join(out, 'madangd.js'))
    await Promise.all(Object.values(entries.MADANGD_CHILD_ENTRY_POINTS).map((entry) => build({
      entryPoints: [entry], bundle: true, platform: 'node', target: 'node18', format: 'cjs',
      outfile: join(out, entries.madangdChildOutputFilename(entry)),
      external: entries.MADANGD_EXTERNAL_MODULES, plugins: [entries.externalNativeAddons],
      logLevel: 'error'
    })))`
  const built = runProcessSync({
    program: process.execPath,
    args: ['--input-type=module', '-e', script],
    cwd: REPO_ROOT,
    env: { ...process.env, MADANG_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 120_000
  })
  expect(built.code, built.stderr.slice(0, 2_000)).toBe(0)
  return readdirSync(directory).map((file) => readFileSync(join(directory, file), 'utf8'))
}

it('ships every worker and child entry madangd loads at runtime', () => {
  const named = new Set(
    buildMadangdBundles().flatMap((text) => text.match(RUNTIME_ENTRY_FILENAME) ?? [])
  )
  const shipped = new Set(madangdArtifactFilenames('linux-x64-glibc', []))
  const missing = [...named].filter(
    (filename) => !shipped.has(filename) && !KNOWN_UNSHIPPED_ENTRIES.has(filename)
  )
  expect(missing, 'add these to MADANGD_ARTIFACTS and build them in build-madangd.mjs').toEqual([])
  for (const filename of KNOWN_UNSHIPPED_ENTRIES) {
    expect(named.has(filename) && !shipped.has(filename), filename).toBe(true)
  }
})

it('ships every child entry build-madangd.mjs builds', async () => {
  const builder = pathToFileURL(join(REPO_ROOT, 'config/scripts/madangd-entry-build.mjs')).href
  const entries = await import(builder)
  const shipped = new Set(madangdArtifactFilenames('linux-x64-glibc', []))
  const built = Object.values<string>(entries.MADANGD_CHILD_ENTRY_POINTS).map((entry) =>
    entries.madangdChildOutputFilename(entry)
  )
  expect(built).toContain('session-scanner-service-entry.js')
  expect(built.filter((filename) => !shipped.has(filename))).toEqual([])
})
