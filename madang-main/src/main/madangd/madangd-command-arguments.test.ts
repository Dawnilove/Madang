import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMadangdWebClientRoot } from './madangd-command-arguments'

describe('resolveMadangdWebClientRoot', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  function scratch(): string {
    const root = mkdtempSync(join(tmpdir(), 'madangd-web-root-'))
    roots.push(root)
    return root
  }

  it('serves a directory that holds the web client index', () => {
    const root = scratch()
    writeFileSync(join(root, 'web-index.html'), '<html></html>')
    expect(resolveMadangdWebClientRoot(root)).toBe(root)
  })

  it('refuses a directory without the index, saying so, rather than advertising a dead URL', () => {
    const warn = vi.fn()
    expect(resolveMadangdWebClientRoot(scratch(), warn)).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('web-index.html'))
  })

  it('stays without a web client when none was handed over', () => {
    const warn = vi.fn()
    expect(resolveMadangdWebClientRoot(undefined, warn)).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
})
