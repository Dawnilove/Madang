import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getSetupCommandSource,
  hasHooksFile,
  hasUnrecognizedOrcaYamlKeys,
  loadHooks
} from './hooks'
import type { Repo } from '../shared/repo-types'
import { readIssueCommand, writeIssueCommand } from './issue-command-file'

// Real files: madang.yaml / .madang win; orca.yaml / .orca are read only when the Madang name is absent.
let repo: string

const yaml = (setup: string, extra = ''): string => `scripts:\n  setup: ${setup}\n${extra}`

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'madang-compat-yaml-'))
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('project yaml file names', () => {
  it('reads madang.yaml when only it exists', () => {
    writeFileSync(join(repo, 'madang.yaml'), yaml('new-setup'))
    expect(hasHooksFile(repo)).toBe(true)
    expect(loadHooks(repo)?.scripts.setup).toBe('new-setup')
  })

  it('reads orca.yaml when only it exists', () => {
    writeFileSync(join(repo, 'orca.yaml'), yaml('old-setup'))
    expect(hasHooksFile(repo)).toBe(true)
    expect(loadHooks(repo)?.scripts.setup).toBe('old-setup')
  })

  it('lets madang.yaml win when both exist, without merging', () => {
    writeFileSync(join(repo, 'madang.yaml'), yaml('new-setup'))
    writeFileSync(join(repo, 'orca.yaml'), yaml('old-setup', '  archive: old-archive\n'))
    const hooks = loadHooks(repo)
    expect(hooks?.scripts.setup).toBe('new-setup')
    expect(hooks?.scripts.archive).toBeUndefined()
  })

  it('does not fall back to orca.yaml when madang.yaml is unusable', () => {
    writeFileSync(join(repo, 'madang.yaml'), 'scripts: [not, a, mapping]')
    writeFileSync(join(repo, 'orca.yaml'), yaml('old-setup'))
    expect(loadHooks(repo)).toBeNull()
  })

  it('hands the orca.yaml setup script to the trust check, same as madang.yaml', () => {
    const repoRecord = { path: repo } as Repo
    writeFileSync(join(repo, 'orca.yaml'), yaml('echo same'))
    const fromOrca = getSetupCommandSource(repoRecord)
    rmSync(join(repo, 'orca.yaml'))
    writeFileSync(join(repo, 'madang.yaml'), yaml('echo same'))
    expect(fromOrca).toEqual({ source: 'yaml', command: 'echo same' })
    expect(getSetupCommandSource(repoRecord)).toEqual(fromOrca)
  })

  it('reports no file when neither exists', () => {
    expect(hasHooksFile(repo)).toBe(false)
    expect(loadHooks(repo)).toBeNull()
  })

  it('checks unknown keys in the file that is read', () => {
    writeFileSync(join(repo, 'madang.yaml'), yaml('x'))
    writeFileSync(join(repo, 'orca.yaml'), 'futureKey: 1\n')
    expect(hasUnrecognizedOrcaYamlKeys(repo)).toBe(false)
    rmSync(join(repo, 'madang.yaml'))
    expect(hasUnrecognizedOrcaYamlKeys(repo)).toBe(true)
  })

  it('reads issueCommand from orca.yaml when only it exists', () => {
    writeFileSync(join(repo, 'orca.yaml'), 'issueCommand: old-shared\n')
    expect(readIssueCommand(repo).sharedContent).toBe('old-shared')
  })
})

describe('.madang / .orca issue-command', () => {
  const madangFile = (): string => join(repo, '.madang', 'issue-command')
  const orcaFile = (): string => join(repo, '.orca', 'issue-command')
  const seed = (file: string, text: string): void => {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, text)
  }

  it('reads .orca/issue-command when .madang has none, and still reports the Madang path', () => {
    seed(orcaFile(), 'old-local\n')
    const result = readIssueCommand(repo)
    expect(result.localContent).toBe('old-local')
    expect(result.source).toBe('local')
    expect(result.localFilePath).toBe(madangFile())
  })

  it('prefers .madang/issue-command when both exist', () => {
    seed(orcaFile(), 'old-local\n')
    seed(madangFile(), 'new-local\n')
    expect(readIssueCommand(repo).localContent).toBe('new-local')
  })

  it('writes only to .madang and leaves the Orca file untouched', async () => {
    seed(orcaFile(), 'old-local\n')
    await writeIssueCommand(repo, 'new-local')
    expect(readFileSync(madangFile(), 'utf-8')).toBe('new-local\n')
    expect(readFileSync(orcaFile(), 'utf-8')).toBe('old-local\n')
    expect(readFileSync(join(repo, '.gitignore'), 'utf-8')).toContain('.madang')
    expect(readIssueCommand(repo).localContent).toBe('new-local')
  })

  it('clearing the override also removes the Orca copy so it cannot come back', async () => {
    seed(orcaFile(), 'old-local\n')
    seed(madangFile(), 'new-local\n')
    writeFileSync(join(repo, 'madang.yaml'), 'issueCommand: shared\n')
    await writeIssueCommand(repo, '  ')
    expect(existsSync(madangFile())).toBe(false)
    expect(existsSync(orcaFile())).toBe(false)
    expect(readIssueCommand(repo).source).toBe('shared')
  })
})
