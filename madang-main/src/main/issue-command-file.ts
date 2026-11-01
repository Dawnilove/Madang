// .madang/issue-command is local (.orca/issue-command is read when it is absent); madang.yaml
// (or orca.yaml) supplies the tracked project default.
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadHooks } from './hooks'
import type { GitRuntimeOptions } from './git/git-runtime-options'
import { checkIgnoredPaths } from './git/check-ignored-paths'
import {
  MADANG_PROJECT_DIR_NAME,
  ORCA_COMPAT_PROJECT_DIR_NAME,
  pickMadangOrCompatName
} from '../shared/orca-compat-yaml'

type IssueCommandGitOptions = GitRuntimeOptions | (() => GitRuntimeOptions)

const ORCA_DIR = MADANG_PROJECT_DIR_NAME
const ISSUE_COMMAND_FILENAME = 'issue-command'

/** Where the override is saved. Always the Madang folder. */
export function getIssueCommandFilePath(repoPath: string): string {
  return join(repoPath, ORCA_DIR, ISSUE_COMMAND_FILENAME)
}

/** Where the override is read from: the Orca folder only when the Madang file is absent. */
function getIssueCommandReadPath(repoPath: string): string {
  const dir = pickMadangOrCompatName(ORCA_DIR, ORCA_COMPAT_PROJECT_DIR_NAME, (name) =>
    existsSync(join(repoPath, name, ISSUE_COMMAND_FILENAME))
  )
  return join(repoPath, dir, ISSUE_COMMAND_FILENAME)
}

export function getSharedIssueCommand(repoPath: string): string | null {
  return loadHooks(repoPath)?.issueCommand?.trim() || null
}

export type ResolvedIssueCommand = {
  localContent: string | null
  sharedContent: string | null
  effectiveContent: string | null
  localFilePath: string
  source: 'local' | 'shared' | 'none'
}

export function readIssueCommand(repoPath: string): ResolvedIssueCommand {
  const filePath = getIssueCommandFilePath(repoPath)
  const readPath = getIssueCommandReadPath(repoPath)
  let localContent: string | null = null

  if (existsSync(readPath)) {
    try {
      const content = readFileSync(readPath, 'utf-8').trim()
      localContent = content || null
    } catch {
      localContent = null
    }
  }

  const sharedContent = getSharedIssueCommand(repoPath)
  const effectiveContent = localContent ?? sharedContent

  return {
    localContent,
    sharedContent,
    effectiveContent,
    localFilePath: filePath,
    source: localContent ? 'local' : sharedContent ? 'shared' : 'none'
  }
}

/** Empty content removes the local override (also the Orca-folder copy) so the shared command applies. */
export async function writeIssueCommand(
  repoPath: string,
  content: string,
  options: IssueCommandGitOptions = {}
): Promise<void> {
  const filePath = getIssueCommandFilePath(repoPath)
  const trimmed = content.trim()

  try {
    if (!trimmed) {
      rmSync(filePath, { force: true })
      // Why: the Orca copy would otherwise become the override again once the Madang file is gone.
      rmSync(join(repoPath, ORCA_COMPAT_PROJECT_DIR_NAME, ISSUE_COMMAND_FILENAME), { force: true })
      return
    }

    const orcaDir = join(repoPath, ORCA_DIR)
    if (!existsSync(orcaDir)) {
      mkdirSync(orcaDir, { recursive: true })
    }
    if (!(await isIssueCommandIgnoredByGit(repoPath, options))) {
      ensureOrcaDirIgnored(repoPath)
    }
    writeFileSync(filePath, `${trimmed}\n`, 'utf-8')
  } catch (err) {
    console.error('[hooks] Failed to write issue command:', err)
    throw err
  }
}

/** Consult Git before changing shared ignore rules for a private override. */
async function isIssueCommandIgnoredByGit(
  repoPath: string,
  options: IssueCommandGitOptions = {}
): Promise<boolean> {
  try {
    const issueCommandPath = `${ORCA_DIR}/${ISSUE_COMMAND_FILENAME}`
    const ignored = await checkIgnoredPaths(
      repoPath,
      [issueCommandPath],
      // Runtime repair must not block saving or clearing the local override.
      typeof options === 'function' ? options() : options
    )
    return ignored.includes(issueCommandPath)
  } catch {
    // Preserve the existing ignore-file fallback if Git cannot inspect the rules.
    return false
  }
}

function ensureOrcaDirIgnored(repoPath: string): void {
  const gitignorePath = join(repoPath, '.gitignore')
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8')
      if (/^\.madang\/?$/m.test(content)) {
        return
      }
      const separator = content.endsWith('\n') ? '' : '\n'
      writeFileSync(gitignorePath, `${content}${separator}.madang\n`, 'utf-8')
    } else {
      writeFileSync(gitignorePath, '.madang\n', 'utf-8')
    }
  } catch {
    console.warn('[hooks] Could not update .gitignore to exclude .madang')
  }
}
