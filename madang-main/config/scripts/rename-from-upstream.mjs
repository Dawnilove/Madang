// Applies the Madang rename map to a source tree, so an upstream (Orca) snapshot can be put into Madang's
// naming before it is three-way merged with our code. The map decides what changes; this file only applies it.
// Usage: node config/scripts/rename-from-upstream.mjs <dir> [--map <file>] [--write]
// Without --write it only prints what would change (a dry run).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MAP = path.join(import.meta.dirname, 'madang-rename-map.json')
const SKIP_DIRS = new Set(['.git', 'node_modules'])

/** Minimal glob: `**` crosses folders, `*` and `?` stay inside one path segment. */
export function globToRegExp(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*'
        i += glob[i + 2] === '/' ? 2 : 1
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

const matchesAny = (relPath, globs) =>
  (globs ?? []).some((glob) => globToRegExp(glob).test(relPath))

// Globs name files as they were before the rename; a second run sees the new names, so try those too.
const matchesAnyRenamed = (relPath, globs, map) =>
  matchesAny(relPath, globs) ||
  matchesAny(
    relPath,
    (globs ?? []).map((glob) => applyPathRules(glob, map))
  )

export function loadMap(file = DEFAULT_MAP) {
  const map = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (map.version !== 1) {
    throw new Error(`unsupported rename map version: ${map.version}`)
  }
  return {
    excludeGlobs: map.excludeGlobs ?? [],
    pathExcludeGlobs: map.pathExcludeGlobs ?? [],
    pathRules: map.pathRules ?? [],
    contentRules: map.contentRules ?? []
  }
}

function applyPathRules(value, map) {
  let result = value
  for (const rule of map.pathRules) {
    result = result.replace(new RegExp(rule.from, rule.flags ?? 'g'), rule.to)
  }
  return result
}

/** Rewrites one relative path (forward slashes). Rules run in order on the whole path. */
export function renamePath(relPath, map) {
  const skipped = matchesAny(relPath, map.excludeGlobs) || matchesAny(relPath, map.pathExcludeGlobs)
  return skipped ? relPath : applyPathRules(relPath, map)
}

// Relative and alias import specifiers follow the file renames, so imports keep resolving.
const IMPORT_SPECIFIER =
  /((?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|unmock|doUnmock|importActual|importMock)\s*\(\s*)(['"]))([^'"\n]+)\2/g

function rewriteImportSpecifiers(text, map, onlyMatching) {
  const only = onlyMatching ? new RegExp(onlyMatching) : null
  let count = 0
  const result = text.replace(IMPORT_SPECIFIER, (whole, head, quote, specifier) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
      return whole
    }
    // A tree whose own files keep their names (mobile/) only follows imports that leave it.
    if (only && !only.test(specifier)) {
      return whole
    }
    const next = applyPathRules(specifier, map)
    if (next !== specifier) {
      count += 1
    }
    return `${head}${next}${quote}`
  })
  return { text: result, count }
}

const stripExt = (file) => file.replace(/\.[^./]+$/, '')

/** Renamed file names that carry an extension, e.g. orcad-entry.ts -> madangd-entry.ts, so bare names in strings follow. */
export function changedBasenames(renames) {
  const names = new Map()
  for (const { from, to } of renames) {
    const before = from.split('/').pop()
    const after = to.split('/').pop()
    if (before !== after && before.includes('.')) {
      names.set(before, after)
    }
  }
  return names
}

/** Every path prefix that changes, e.g. src/a/orcad -> src/a/madangd, so folder names in configs follow too. */
export function changedPrefixes(renames) {
  const prefixes = new Map()
  for (const { from, to } of renames) {
    // A path without its extension (a module id in a string) follows the file too.
    if (stripExt(from) !== stripExt(to)) {
      prefixes.set(stripExt(from), stripExt(to))
    }
    const fromParts = from.split('/')
    const toParts = to.split('/')
    for (let i = 1; i <= fromParts.length; i++) {
      const before = fromParts.slice(0, i).join('/')
      const after = toParts.slice(0, i).join('/')
      if (before !== after) {
        prefixes.set(before, after)
      }
    }
    // Relative references (../../main/runtime/x) cut the front off, so inner windows of 2+ segments count too.
    for (const [a, b] of [
      [fromParts, toParts],
      [stripExt(from).split('/'), stripExt(to).split('/')]
    ]) {
      for (let start = 0; start < a.length - 1; start++) {
        for (let end = start + 2; end <= a.length; end++) {
          const before = a.slice(start, end).join('/')
          const after = b.slice(start, end).join('/')
          if (before !== after && !prefixes.has(before)) {
            prefixes.set(before, after)
          }
        }
      }
    }
  }
  return prefixes
}

// Path-like words only; a prefix must match whole segments, so a/orcad-extra stays when a/orcad moves.
const PATH_TOKEN = /[\w.@~-]+(?:\/[\w.@~-]+)+/g

function rewriteToken(token, prefixes) {
  const parts = token.split('/')
  const out = []
  let changed = false
  let i = 0
  while (i < parts.length) {
    let matched = false
    for (let end = parts.length; end > i; end--) {
      const replacement = prefixes.get(parts.slice(i, end).join('/'))
      if (replacement !== undefined) {
        out.push(replacement)
        i = end
        matched = true
        changed = true
        break
      }
    }
    if (!matched) {
      out.push(parts[i])
      i += 1
    }
  }
  return changed ? out.join('/') : token
}

function rewritePathReferences(text, prefixes) {
  let count = 0
  const result = text.replace(PATH_TOKEN, (token) => {
    const next = rewriteToken(token, prefixes)
    if (next !== token) {
      count += 1
    }
    return next
  })
  return { text: result, count }
}

const escapeRegExp = (value) => value.replace(/[.+^${}()|[\]\\]/g, '\\$&')

function rewriteBasenames(text, basenames) {
  if (basenames.size === 0) {
    return { text, count: 0 }
  }
  const escaped = [...basenames.keys()].map(escapeRegExp)
  const pattern = new RegExp(`(?<![\\w@-])(${escaped.join('|')})(?![\\w-])`, 'g')
  let count = 0
  const result = text.replace(pattern, (name) => {
    count += 1
    return basenames.get(name)
  })
  // A whole file name without its extension in quotes, e.g. workflow('wsl-orcad-e2e'), is a name too.
  // Only hyphenated stems: a short word like 'orca' is also a command or identifier, not just a file.
  const stems = new Map(
    [...basenames]
      .map(([from, to]) => [stripExt(from), stripExt(to)])
      .filter(([from]) => from.includes('-'))
  )
  if (stems.size === 0) {
    return { text: result, count }
  }
  const quoted = new RegExp(`(['"\`])(${[...stems.keys()].map(escapeRegExp).join('|')})\\1`, 'g')
  const done = result.replace(quoted, (whole, quote, stem) => {
    count += 1
    return `${quote}${stems.get(stem)}${quote}`
  })
  return { text: done, count }
}

// Names that code reads or sets as environment variables. A constant that only exists as an identifier
// (ORCA_LAYOUT_OWNER_IS_MAIN) never shows up in the strong shapes, so it keeps its name.
const ESCAPE_OR_BOUNDARY = String.raw`(?:(?<![A-Za-z0-9_])|(?<=\\[nrtbfv]))`
const ENV_STRONG_PATTERNS = [
  /process\.env\.(ORCA_[A-Z0-9_]+)/g,
  /env\[\s*['"`](ORCA_[A-Z0-9_]+)['"`]\s*\]/g,
  /['"`](ORCA_[A-Z0-9_]+)['"`]/g,
  /\$(ORCA_[A-Z0-9_]+)/g,
  /\$\{(ORCA_[A-Z0-9_]+)[:\-+=?#%/]/g,
  new RegExp(`${ESCAPE_OR_BOUNDARY}(ORCA_[A-Z0-9_]+)=`, 'g'),
  new RegExp(`${ESCAPE_OR_BOUNDARY}export\\s+(ORCA_[A-Z0-9_]+)`, 'g'),
  /\$env:(ORCA_[A-Z0-9_]+)/g
]
// "${NAME}" is a shell variable in a script but an interpolated constant in a JS template string, so it
// only counts when the name is not declared as a JS constant somewhere.
const ENV_WEAK_PATTERNS = [
  /\$\{(ORCA_[A-Z0-9_]+)\}/g,
  // A prefix that code appends to (ORCA_AGENT_HOOK_ followed by an interpolation).
  /\b(ORCA_[A-Z0-9_]*[A-Z0-9]_)(?=\$\{)/g
]
const JS_DECLARATION = /\b(?:const|let|var|enum|function|class)\s+(ORCA_[A-Z0-9_]+)\b/g

/** Finds every environment variable name in the text files the content rules may touch. */
export function collectEnvNames(files, map) {
  const strong = new Set()
  const weak = new Set()
  const declared = new Set()
  for (const { rel, text } of files) {
    // A name declared in an excluded file (the compat files) is still a constant for its importers.
    for (const match of text.matchAll(JS_DECLARATION)) {
      declared.add(match[1])
    }
    // Locale files list env names in help text too; read them even though other rules skip them.
    const reachable =
      !matchesAnyRenamed(rel, map.excludeGlobs, map) ||
      map.contentRules.some(
        (rule) => rule.type === 'env-names' && matchesAnyRenamed(rel, rule.forceInclude, map)
      )
    if (!reachable) {
      continue
    }
    for (const pattern of ENV_STRONG_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        strong.add(match[1])
      }
    }
    for (const pattern of ENV_WEAK_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        weak.add(match[1])
      }
    }
  }
  const names = new Set(strong)
  for (const name of weak) {
    if (!declared.has(name)) {
      names.add(name)
    }
  }
  return names
}

function rewriteEnvNames(text, rule, envNames) {
  let count = 0
  const result = text.replace(
    new RegExp(`${ESCAPE_OR_BOUNDARY}${escapeRegExp(rule.from)}[A-Z0-9_]+`, 'g'),
    (token) => {
      if (!envNames.has(token)) {
        return token
      }
      count += 1
      return rule.to + token.slice(rule.from.length)
    }
  )
  return { text: result, count }
}

/** Rewrites text content with every content rule whose include/exclude globs allow this path. */
export function transformContent(
  relPath,
  text,
  map,
  prefixes = new Map(),
  basenames = new Map(),
  envNames = new Set()
) {
  const excluded = matchesAnyRenamed(relPath, map.excludeGlobs, map)
  let result = text
  let count = 0
  for (const rule of map.contentRules) {
    // A rule may opt back in to excluded paths (the env-name rule must reach the locale files).
    if (excluded && !matchesAnyRenamed(relPath, rule.forceInclude, map)) {
      continue
    }
    if (rule.include && !matchesAnyRenamed(relPath, rule.include, map)) {
      continue
    }
    if (rule.exclude && matchesAnyRenamed(relPath, rule.exclude, map)) {
      continue
    }
    if (
      rule.type === 'import-specifiers' ||
      rule.type === 'path-references' ||
      rule.type === 'file-name-references' ||
      rule.type === 'env-names'
    ) {
      const done =
        rule.type === 'import-specifiers'
          ? rewriteImportSpecifiers(result, map, rule.onlyMatching)
          : rule.type === 'path-references'
            ? rewritePathReferences(result, prefixes)
            : rule.type === 'env-names'
              ? rewriteEnvNames(result, rule, envNames)
              : rewriteBasenames(result, basenames)
      result = done.text
      count += done.count
      continue
    }
    const pattern = new RegExp(rule.pattern, rule.flags ?? 'g')
    const matches = result.match(pattern)
    if (matches) {
      count += matches.length
      result = result.replace(pattern, rule.replacement)
    }
  }
  return { text: result, count }
}

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0)
}

function* walk(root, rel = '') {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* walk(root, rel ? `${rel}/${entry.name}` : entry.name)
      }
    } else if (entry.isFile()) {
      yield rel ? `${rel}/${entry.name}` : entry.name
    }
  }
}

// A git checkout lists tracked files only, so build output and caches never count; a plain
// snapshot folder (an unpacked upstream release) falls back to walking the tree.
function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const tracked = out.split('\0').filter(Boolean)
    if (tracked.length > 0) {
      return tracked.filter((rel) => fs.existsSync(path.join(root, rel)))
    }
  } catch {
    // Not a git checkout.
  }
  return [...walk(root)]
}

/** Plans (and optionally applies) path renames and content edits under `root`. */
export function renameTree(root, map, { write = false } = {}) {
  const renames = []
  const edits = []
  const targets = new Map()
  const files = listFiles(root)
  for (const rel of files) {
    const target = renamePath(rel, map)
    if (targets.has(target)) {
      throw new Error(`rename collision: ${targets.get(target)} and ${rel} both become ${target}`)
    }
    targets.set(target, rel)
    if (target !== rel) {
      renames.push({ from: rel, to: target })
    }
  }
  const prefixes = changedPrefixes(renames)
  const basenames = changedBasenames(renames)
  const texts = []
  for (const rel of files) {
    const buffer = fs.readFileSync(path.join(root, rel))
    if (!isBinary(buffer)) {
      texts.push({ rel, text: buffer.toString('utf8') })
    }
  }
  const envNames = map.contentRules.some((rule) => rule.type === 'env-names')
    ? collectEnvNames(texts, map)
    : new Set()
  for (const { rel, text: original } of texts) {
    const { text, count } = transformContent(rel, original, map, prefixes, basenames, envNames)
    if (text !== original) {
      edits.push({ file: rel, count })
      if (write) {
        fs.writeFileSync(path.join(root, rel), text)
      }
    }
  }
  if (write) {
    for (const { from, to } of renames) {
      fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true })
      fs.renameSync(path.join(root, from), path.join(root, to))
    }
    removeEmptyDirs(root)
  }
  return { renames, edits }
}

function removeEmptyDirs(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      const dir = path.join(root, entry.name)
      removeEmptyDirs(dir)
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir)
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const root = args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--map')
  const mapIndex = args.indexOf('--map')
  if (!root) {
    console.error('usage: rename-from-upstream.mjs <dir> [--map <file>] [--write]')
    process.exit(2)
  }
  const map = loadMap(mapIndex !== -1 ? args[mapIndex + 1] : DEFAULT_MAP)
  const write = args.includes('--write')
  const { renames, edits } = renameTree(path.resolve(root), map, { write })
  console.log(
    JSON.stringify(
      { mode: write ? 'write' : 'dry-run', renames: renames.length, editedFiles: edits.length },
      null,
      2
    )
  )
}
