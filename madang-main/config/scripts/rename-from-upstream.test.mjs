import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  globToRegExp,
  loadMap,
  renamePath,
  renameTree,
  transformContent
} from './rename-from-upstream.mjs'

const roots = []

function tempTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'madang-rename-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), content)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

const map = {
  excludeGlobs: ['LICENSE', 'mobile/**'],
  pathRules: [{ from: 'orca-installer', to: 'madang-installer' }],
  contentRules: [
    { pattern: '\\bORCA_(?!LAYOUT_OWNER_IS_MAIN\\b)', replacement: 'MADANG_', include: ['src/**'] },
    { pattern: 'orca\\.yaml', replacement: 'madang.yaml', exclude: ['src/legacy/**'] }
  ]
}

describe('globToRegExp', () => {
  it('lets ** cross folders and * stay in one segment', () => {
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false)
    expect(globToRegExp('**/*.png').test('a/b/c.png')).toBe(true)
    expect(globToRegExp('LICENSE').test('LICENSE')).toBe(true)
  })
})

describe('renamePath', () => {
  it('applies path rules and leaves excluded paths alone', () => {
    expect(renamePath('config/nsis/orca-installer-hooks.nsh', map)).toBe(
      'config/nsis/madang-installer-hooks.nsh'
    )
    expect(renamePath('mobile/orca-installer.txt', map)).toBe('mobile/orca-installer.txt')
  })
})

describe('transformContent', () => {
  it('keeps listed internal names and honors include/exclude globs', () => {
    const source = 'ORCA_PANE_KEY ORCA_LAYOUT_OWNER_IS_MAIN orca.yaml'
    expect(transformContent('src/a.ts', source, map).text).toBe(
      'MADANG_PANE_KEY ORCA_LAYOUT_OWNER_IS_MAIN madang.yaml'
    )
    expect(transformContent('docs/a.md', source, map).text).toBe(
      'ORCA_PANE_KEY ORCA_LAYOUT_OWNER_IS_MAIN madang.yaml'
    )
    expect(transformContent('src/legacy/a.ts', source, map).text).toBe(
      'MADANG_PANE_KEY ORCA_LAYOUT_OWNER_IS_MAIN orca.yaml'
    )
    expect(transformContent('LICENSE', source, map)).toEqual({ text: source, count: 0 })
  })
})

describe('renameTree', () => {
  it('dry run reports changes without touching files', () => {
    const root = tempTree({ 'src/a.ts': 'ORCA_X', 'config/orca-installer.nsh': 'x' })
    const result = renameTree(root, map)
    expect(result.edits).toEqual([{ file: 'src/a.ts', count: 1 }])
    expect(result.renames).toEqual([
      { from: 'config/orca-installer.nsh', to: 'config/madang-installer.nsh' }
    ])
    expect(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe('ORCA_X')
    expect(fs.existsSync(path.join(root, 'config/orca-installer.nsh'))).toBe(true)
  })

  it('writes edits and renames, and a second run changes nothing', () => {
    const root = tempTree({
      'src/a.ts': 'ORCA_X orca.yaml',
      'config/orca-installer.nsh': 'x',
      'mobile/m.ts': 'ORCA_X'
    })
    renameTree(root, map, { write: true })
    expect(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe('MADANG_X madang.yaml')
    expect(fs.existsSync(path.join(root, 'config/madang-installer.nsh'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'config/orca-installer.nsh'))).toBe(false)
    expect(fs.readFileSync(path.join(root, 'mobile/m.ts'), 'utf8')).toBe('ORCA_X')
    expect(renameTree(root, map)).toEqual({ renames: [], edits: [] })
  })

  it('refuses a rename that lands on an existing file', () => {
    const root = tempTree({ 'a/orca-installer.txt': '1', 'a/madang-installer.txt': '2' })
    expect(() => renameTree(root, map)).toThrow(/collision/)
  })

  it('skips binary files and node_modules', () => {
    const root = tempTree({ 'node_modules/x/orca-installer.txt': 'a' })
    fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, 79, 82, 67, 65]))
    expect(renameTree(root, map)).toEqual({ renames: [], edits: [] })
  })
})

describe('loadMap', () => {
  it('loads the checked-in map with a supported version', () => {
    const loaded = loadMap()
    expect(loaded.excludeGlobs).toContain('LICENSE')
  })
})

describe('import specifiers and path references', () => {
  const fileMap = {
    excludeGlobs: [],
    pathRules: [{ from: 'orcad', to: 'madangd' }],
    contentRules: [{ type: 'import-specifiers' }, { type: 'path-references' }]
  }

  it('moves files, rewrites relative imports and leaves package names and plain strings alone', () => {
    const root = tempTree({
      'src/orcad/server.ts': 'export const a = 1',
      'src/main.ts': [
        "import { a } from './orcad/server'",
        "import x from 'orcad-sdk'",
        "const lazy = await import('../src/orcad/server')",
        "vi.mock('./orcad/server', () => ({}))",
        "const label = 'orcad is a word here'"
      ].join('\n'),
      'package.json': '{ "build": "node src/orcad/server.ts" }'
    })
    renameTree(root, fileMap, { write: true })
    expect(fs.existsSync(path.join(root, 'src/madangd/server.ts'))).toBe(true)
    expect(fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')).toBe(
      [
        "import { a } from './madangd/server'",
        "import x from 'orcad-sdk'",
        "const lazy = await import('../src/madangd/server')",
        "vi.mock('./madangd/server', () => ({}))",
        "const label = 'orcad is a word here'"
      ].join('\n')
    )
    expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(
      '{ "build": "node src/madangd/server.ts" }'
    )
  })

  it('does not rewrite a path that only shares a prefix with a renamed folder', () => {
    const root = tempTree({ 'a/orcad/x.ts': '1', 'b.txt': 'a/orcad-extra/x.ts a/orcad/x.ts' })
    renameTree(root, fileMap, { write: true })
    expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe(
      'a/orcad-extra/x.ts a/madangd/x.ts'
    )
  })
})

describe('pathExcludeGlobs', () => {
  it('keeps a path name but still rewrites its content', () => {
    const root = tempTree({ 'keep/orcad.txt': 'orcad', 'move/orcad.txt': 'x' })
    const mapWithKeep = {
      excludeGlobs: [],
      pathExcludeGlobs: ['keep/**'],
      pathRules: [{ from: 'orcad', to: 'madangd' }],
      contentRules: [{ pattern: 'orcad', replacement: 'madangd' }]
    }
    renameTree(root, mapWithKeep, { write: true })
    expect(fs.readFileSync(path.join(root, 'keep/orcad.txt'), 'utf8')).toBe('madangd')
    expect(fs.existsSync(path.join(root, 'move/madangd.txt'))).toBe(true)
  })
})

describe('file name references', () => {
  const nameMap = {
    excludeGlobs: ['docs/**'],
    pathRules: [{ from: 'orcad', to: 'madangd' }],
    contentRules: [{ type: 'path-references' }, { type: 'file-name-references' }]
  }

  it('follows bare file names and extension-less module ids, and leaves docs and look-alikes alone', () => {
    const root = tempTree({
      'src/orcad/orcad-entry.ts': 'x',
      'docs/note.md': 'orcad-entry.ts',
      'src/a.test.ts': [
        "fs.readFileSync(path.join(dir, 'orcad-entry.ts'))",
        "load('src/orcad/orcad-entry')",
        "const other = 'my-orcad-entry.ts'"
      ].join('\n')
    })
    renameTree(root, nameMap, { write: true })
    expect(fs.readFileSync(path.join(root, 'src/a.test.ts'), 'utf8')).toBe(
      [
        "fs.readFileSync(path.join(dir, 'madangd-entry.ts'))",
        "load('src/madangd/madangd-entry')",
        "const other = 'my-orcad-entry.ts'"
      ].join('\n')
    )
    expect(fs.readFileSync(path.join(root, 'docs/note.md'), 'utf8')).toBe('orcad-entry.ts')
  })
})

describe('relative references and quoted names', () => {
  const relMap = {
    excludeGlobs: [],
    pathRules: [{ from: 'orcad', to: 'madangd' }],
    contentRules: [{ type: 'path-references' }, { type: 'file-name-references' }]
  }

  it('follows a cut-off relative path and a quoted extension-less file name', () => {
    const root = tempTree({
      'src/main/runtime/orcad-runtime.ts': 'x',
      '.github/workflows/wsl-orcad-e2e.yml': 'x',
      't.test.ts':
        "load('../../main/runtime/orcad-runtime'); workflow('wsl-orcad-e2e'); 'wsl-orcad-e2e-extra'"
    })
    renameTree(root, relMap, { write: true })
    expect(fs.readFileSync(path.join(root, 't.test.ts'), 'utf8')).toBe(
      "load('../../main/runtime/madangd-runtime'); workflow('wsl-madangd-e2e'); 'wsl-orcad-e2e-extra'"
    )
  })
})

describe('short quoted names', () => {
  it('keeps a quoted one-word name that is also a command', () => {
    const root = tempTree({
      'bin/orca.cmd': 'x',
      't.ts': "const bin = 'orca'; const file = 'orca.cmd'"
    })
    renameTree(
      root,
      {
        excludeGlobs: [],
        pathRules: [{ from: 'orca', to: 'madang' }],
        contentRules: [{ type: 'file-name-references' }]
      },
      { write: true }
    )
    expect(fs.readFileSync(path.join(root, 't.ts'), 'utf8')).toBe(
      "const bin = 'orca'; const file = 'madang.cmd'"
    )
  })
})

describe('second run', () => {
  it('keeps an excluded file excluded after its name changed, so a re-run changes nothing', () => {
    const root = tempTree({
      'config/orcad-x.mjs': "const dir = 'orcad-template'",
      'config/other.mjs': "'orcad-y'"
    })
    const rerunMap = {
      excludeGlobs: [],
      pathRules: [{ from: 'orcad', to: 'madangd' }],
      contentRules: [
        {
          pattern: 'orcad',
          replacement: 'madangd',
          include: ['config/**'],
          exclude: ['config/orcad-x*']
        }
      ]
    }
    renameTree(root, rerunMap, { write: true })
    expect(fs.readFileSync(path.join(root, 'config/madangd-x.mjs'), 'utf8')).toBe(
      "const dir = 'orcad-template'"
    )
    expect(renameTree(root, rerunMap)).toEqual({ renames: [], edits: [] })
  })
})

describe('environment variable names', () => {
  const envMap = {
    excludeGlobs: ['docs/**'],
    pathRules: [],
    contentRules: [{ type: 'env-names', from: 'ORCA_', to: 'MADANG_' }]
  }

  it('renames names used as environment variables and keeps identifier-only constants', () => {
    const root = tempTree({
      'src/a.ts': [
        'const key = process.env.ORCA_PANE_KEY',
        "const other = env['ORCA_TAB_ID']",
        'export const ORCA_LAYOUT_OWNER_IS_MAIN = true',
        'if (ORCA_LAYOUT_OWNER_IS_MAIN) run()',
        'const hook = `ORCA_AGENT_HOOK_${name}`'
      ].join('\n'),
      'src/run.sh': 'export ORCA_WORKTREE_ID=1\necho "$ORCA_WORKTREE_ID" ORCA_PANE_KEY_EXTRA',
      'docs/note.md': 'ORCA_PANE_KEY'
    })
    renameTree(root, envMap, { write: true })
    expect(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe(
      [
        'const key = process.env.MADANG_PANE_KEY',
        "const other = env['MADANG_TAB_ID']",
        'export const ORCA_LAYOUT_OWNER_IS_MAIN = true',
        'if (ORCA_LAYOUT_OWNER_IS_MAIN) run()',
        'const hook = `MADANG_AGENT_HOOK_${name}`'
      ].join('\n')
    )
    expect(fs.readFileSync(path.join(root, 'src/run.sh'), 'utf8')).toBe(
      'export MADANG_WORKTREE_ID=1\necho "$MADANG_WORKTREE_ID" ORCA_PANE_KEY_EXTRA'
    )
    expect(fs.readFileSync(path.join(root, 'docs/note.md'), 'utf8')).toBe('ORCA_PANE_KEY')
    expect(renameTree(root, envMap)).toEqual({ renames: [], edits: [] })
  })
})

describe('forceInclude', () => {
  it('lets the env-name rule reach an excluded locale file while other rules skip it', () => {
    const root = tempTree({
      'locales/en.json': '{"a": "Set ORCA_TOKEN to ORCA_PLAIN"}',
      'src/a.ts': 'const t = process.env.ORCA_TOKEN'
    })
    const forceMap = {
      excludeGlobs: ['locales/**'],
      pathRules: [],
      contentRules: [
        { pattern: 'PLAIN', replacement: 'X' },
        { type: 'env-names', from: 'ORCA_', to: 'MADANG_', forceInclude: ['locales/**'] }
      ]
    }
    renameTree(root, forceMap, { write: true })
    expect(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8')).toBe(
      '{"a": "Set MADANG_TOKEN to ORCA_PLAIN"}'
    )
  })
})

describe('constant interpolated into a template string', () => {
  it('keeps a declared constant used as an interpolation and still renames a shell variable', () => {
    const root = tempTree({
      'src/consts.ts': 'export const ORCA_API_ORIGIN = "https://x"',
      'src/use.ts': 'const url = `${ORCA_API_ORIGIN}/v1`',
      'src/run.sh': 'echo "${ORCA_PANE_KEY}" ${ORCA_TAB_ID:-none}'
    })
    const envOnlyMap = {
      excludeGlobs: [],
      pathRules: [],
      contentRules: [{ type: 'env-names', from: 'ORCA_', to: 'MADANG_' }]
    }
    renameTree(root, envOnlyMap, { write: true })
    expect(fs.readFileSync(path.join(root, 'src/use.ts'), 'utf8')).toBe(
      'const url = `${ORCA_API_ORIGIN}/v1`'
    )
    expect(fs.readFileSync(path.join(root, 'src/run.sh'), 'utf8')).toBe(
      'echo "${MADANG_PANE_KEY}" ${MADANG_TAB_ID:-none}'
    )
  })
})

describe('name after a string escape', () => {
  it('renames an env name that follows a backslash escape in a string literal', () => {
    const root = tempTree({
      'src/a.ts': "const s = 'ok\nORCA_TOKEN=1\n'; const t = process.env.ORCA_TOKEN"
    })
    renameTree(
      root,
      {
        excludeGlobs: [],
        pathRules: [],
        contentRules: [{ type: 'env-names', from: 'ORCA_', to: 'MADANG_' }]
      },
      { write: true }
    )
    expect(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe(
      "const s = 'ok\nMADANG_TOKEN=1\n'; const t = process.env.MADANG_TOKEN"
    )
  })
})

describe('imports that leave a tree whose own names are kept', () => {
  it('follows an import into the renamed app but leaves the tree-internal import', () => {
    const root = tempTree({
      'src/shared/orcad-flag.ts': 'export const FLAG = 1',
      'mobile/modules/orca-shell/load.ts': 'export const L = 1',
      'mobile/src/a.ts': [
        "import { FLAG } from '../../src/shared/orcad-flag'",
        "import { L } from '../modules/orca-shell/load'"
      ].join('\n')
    })
    renameTree(
      root,
      {
        excludeGlobs: ['mobile/**'],
        pathRules: [
          { from: 'orcad', to: 'madangd' },
          { from: 'orca', to: 'madang' }
        ],
        contentRules: [
          {
            type: 'import-specifiers',
            forceInclude: ['mobile/**'],
            onlyMatching: '^(?:../)+src/'
          }
        ]
      },
      { write: true }
    )
    expect(fs.readFileSync(path.join(root, 'mobile/src/a.ts'), 'utf8')).toBe(
      [
        "import { FLAG } from '../../src/shared/madangd-flag'",
        "import { L } from '../modules/orca-shell/load'"
      ].join('\n')
    )
  })
})
