// Change only template build identity to model an app update bundling a newer madangd.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  MADANGD_TEMPLATE_MANIFEST_FILENAME,
  MADANGD_VERSION
} from '../../../src/shared/madangd-artifacts'

const ENTRY = 'madangd.js'

/** Rewrites `templateDir` in place; its manifest keeps verifying. */
export function makeMadangdTemplateVariant(templateDir: string, tag: string): void {
  const entry = path.join(templateDir, ENTRY)
  appendFileSync(entry, `\n// madangd e2e template variant ${tag}\n`)
  const manifestPath = path.join(templateDir, MADANGD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.commonSha256[ENTRY] = createHash('sha256').update(readFileSync(entry)).digest('hex')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** The host's activation record, read the way a client reads it. */
export function readHostMadangdActivation(exec: (command: string) => string): {
  active?: string
  previous?: string
  activeAppVersion?: string
} {
  return JSON.parse(exec('cat "$HOME/.madang-remote/madangd-active.json"'))
}

export function isMadangdFullVersion(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${MADANGD_VERSION}+`)
}
