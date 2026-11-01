// Key-level three-way merge of a locale JSON file (Madang fork vs. upstream Orca).
// A line merge conflicts on neighbouring edits even when no key was touched by both sides.
// Usage: node config/scripts/merge-upstream-locale.mjs <base.json> <ours.json> <upstream.json> [out.json]
// base = file at the last upstream snapshot we took. Writes to out.json, or stdout.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Starts from upstream's shape and order. Our changed values win; keys only we added are appended to
 * their parent. A key both sides changed keeps ours and is listed in `conflicts`.
 */
export function mergeLocale(base, ours, upstream, path = '', conflicts = []) {
  const merged = {}
  for (const [key, up] of Object.entries(upstream)) {
    const here = path ? `${path}.${key}` : key
    const b = base?.[key]
    const o = ours?.[key]
    if (isObject(up)) {
      merged[key] = mergeLocale(isObject(b) ? b : {}, isObject(o) ? o : {}, up, here, conflicts)
    } else if (o === undefined) {
      // We never had it (upstream added it) or we deleted it; delete only counts when base had it.
      if (b === undefined) {
        merged[key] = up
      }
    } else if (o === b || o === up) {
      merged[key] = up
    } else {
      if (up !== b) {
        conflicts.push(here)
      }
      merged[key] = o
    }
  }
  for (const [key, o] of Object.entries(ours ?? {})) {
    if (key in upstream) {
      continue
    }
    const here = path ? `${path}.${key}` : key
    const b = base?.[key]
    // Upstream removed a key we still had: drop it only if we never edited it.
    if (b === undefined || JSON.stringify(b) !== JSON.stringify(o)) {
      merged[key] = o
      if (b !== undefined) {
        conflicts.push(here)
      }
    }
  }
  return merged
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [baseFile, oursFile, upstreamFile, outFile] = process.argv.slice(2)
  if (!baseFile || !oursFile || !upstreamFile) {
    console.error('Usage: merge-upstream-locale.mjs <base> <ours> <upstream> [out]')
    process.exit(1)
  }
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
  const conflicts = []
  const merged = mergeLocale(read(baseFile), read(oursFile), read(upstreamFile), '', conflicts)
  const text = `${JSON.stringify(merged, null, 2)}\n`
  if (outFile) {
    fs.writeFileSync(outFile, text)
  } else {
    process.stdout.write(text)
  }
  console.error(`key conflicts (kept ours): ${conflicts.length}`)
  for (const key of conflicts) {
    console.error(`  ${key}`)
  }
}
