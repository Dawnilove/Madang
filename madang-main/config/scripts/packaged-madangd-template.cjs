// Desktop deployment template ships JS/addons for every target, with no Node runtime (D2); SSH/managed deployments materialize its slots.
// Reseal SignPath-modified binaries: node config/scripts/packaged-madangd-template.cjs --reseal-signed <appDir> <signedListFile>.
const { createHash } = require('node:crypto')
const {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync
} = require('node:fs')
const { join, relative, resolve, sep } = require('node:path')
const {
  MADANGD_TEMPLATE_MANIFEST_FILENAME,
  MADANGD_TEMPLATE_TARGETS_DIR
} = require('../../src/shared/madangd-artifacts.ts')
const { verifyPackagedMadangdTemplate } = require('./verify-packaged-madangd-template.cjs')
const {
  compactPackagedMadangdRipgrep,
  resealSignedPackagedRipgrep
} = require('./compact-packaged-madangd-ripgrep.cjs')

const MADANGD_TEMPLATE_RESOURCE_DIR = 'madangd-template'
const madangdTemplateExtraResource = { from: 'out/madangd-template', to: MADANGD_TEMPLATE_RESOURCE_DIR }
// Why a second entry: electron-builder's copy filter always drops a source's root node_modules.
const madangdTemplateNodeModulesExtraResource = {
  from: `${madangdTemplateExtraResource.from}/node_modules`,
  to: `${MADANGD_TEMPLATE_RESOURCE_DIR}/node_modules`
}
// Exclude whole tree from automatic codesign (ELF/PE); afterPack signs darwin files and reseals their hashes before app signing.
const madangdTemplateMacSignIgnore = ['/madangd-template/']

// Mach-O thin (both byte orders, 32/64-bit) and fat headers.
const MACH_O_MAGICS = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'])

/** Release packaging sets it; dev and local builds may ship without the template. */
function isMadangdTemplateRequired(env = process.env) {
  return env.MADANG_REQUIRE_MADANGD_TEMPLATE === '1'
}

// Why: electron-builder only warns on a missing extraResources source.
function assertMadangdTemplateBuilt(projectDir = join(__dirname, '..', '..'), env = process.env) {
  const manifest = join(
    projectDir,
    madangdTemplateExtraResource.from,
    MADANGD_TEMPLATE_MANIFEST_FILENAME
  )
  if (isMadangdTemplateRequired(env) && !existsSync(manifest)) {
    throw new Error(
      `MADANG_REQUIRE_MADANGD_TEMPLATE=1 but ${manifest} is missing; download the merged template ` +
        'from the release template job, or build it with `pnpm build:madangd-template`.'
    )
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function isMachO(path) {
  const fd = openSync(path, 'r')
  try {
    const header = Buffer.alloc(4)
    return readSync(fd, header, 0, 4, 0) === 4 && MACH_O_MAGICS.has(header.toString('hex'))
  } finally {
    closeSync(fd)
  }
}

/** Template-relative paths of the darwin targets' Mach-O files, which macOS signing rewrites. */
function findMadangdTemplateMachOFiles(templateDir) {
  const targetsDir = join(templateDir, MADANGD_TEMPLATE_TARGETS_DIR)
  return readdirSync(targetsDir)
    .filter((target) => target.startsWith('darwin-'))
    .flatMap((target) =>
      readdirSync(join(targetsDir, target), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && isMachO(join(entry.parentPath, entry.name)))
        .map((entry) =>
          relative(templateDir, join(entry.parentPath, entry.name)).split(sep).join('/')
        )
    )
    .sort()
}

// Reseal only signer-named files; verify all others against build hashes so resealing cannot launder unrelated changes.
function resealMadangdTemplateManifest(templateDir, signedPaths) {
  const manifestPath = join(templateDir, MADANGD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const path of signedPaths) {
    const segments = path.split('/')
    const target =
      segments[0] === MADANGD_TEMPLATE_TARGETS_DIR ? manifest.targets?.[segments[1]] : undefined
    const filename = segments.slice(2).join('/')
    const digest = () => sha256(join(templateDir, ...segments))
    if (target?.files && Object.hasOwn(target.files, filename)) {
      target.files[filename] = digest()
    } else if (target && target.browserName === filename) {
      target.browserSha256 = digest()
    } else if (!target && Object.hasOwn(manifest.commonSha256 ?? {}, path)) {
      manifest.commonSha256[path] = digest()
    } else {
      throw new Error(`[packaged-madangd-template] ${path} is not a template manifest entry`)
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

// Notarization requires Developer ID on nested Mach-O: afterPack signs, reseals and verifies exact shipped bytes.
async function finalizePackagedMadangdTemplate(resourcesDir, options) {
  const { platform, env = process.env, signMacBinary } = options
  const templateDir = join(resourcesDir, MADANGD_TEMPLATE_RESOURCE_DIR)
  if (!existsSync(templateDir)) {
    if (isMadangdTemplateRequired(env)) {
      throw new Error(`Packaged app is missing the madangd deployment template: ${templateDir}`)
    }
    console.log('[packaged-madangd-template] skipped: this build ships no madangd template')
    return
  }
  if (platform === 'darwin') {
    const machO = findMadangdTemplateMachOFiles(templateDir)
    for (const path of machO) {
      await signMacBinary(join(templateDir, ...path.split('/')))
    }
    resealMadangdTemplateManifest(templateDir, machO)
  }
  compactPackagedMadangdRipgrep(resourcesDir)
}

/** `inner-signing-list.txt` lines are app-relative Windows paths; keep the template's. */
function resealSignedWindowsApp(appDir, signedListFile) {
  const prefix = `resources/${MADANGD_TEMPLATE_RESOURCE_DIR}/`
  const signedAppPaths = readFileSync(signedListFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll('\\', '/'))
  const signed = signedAppPaths
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length))
  const resourcesDir = join(appDir, 'resources')
  if (!existsSync(join(resourcesDir, MADANGD_TEMPLATE_RESOURCE_DIR))) {
    if (isMadangdTemplateRequired()) {
      throw new Error(`Signed app is missing the madangd deployment template under ${resourcesDir}`)
    }
    console.log('[packaged-madangd-template] skipped reseal: this build ships no madangd template')
    return
  }
  resealMadangdTemplateManifest(join(resourcesDir, MADANGD_TEMPLATE_RESOURCE_DIR), signed)
  resealSignedPackagedRipgrep(
    resourcesDir,
    signedAppPaths.filter((path) => path.startsWith('resources/')).map((path) => path.slice(10))
  )
  verifyPackagedMadangdTemplate(resourcesDir)
  console.log(`[packaged-madangd-template] resealed ${signed.length} signed template file(s)`)
}

module.exports = {
  MADANGD_TEMPLATE_RESOURCE_DIR,
  assertMadangdTemplateBuilt,
  finalizePackagedMadangdTemplate,
  findMadangdTemplateMachOFiles,
  isMadangdTemplateRequired,
  madangdTemplateExtraResource,
  madangdTemplateNodeModulesExtraResource,
  madangdTemplateMacSignIgnore,
  resealMadangdTemplateManifest,
  resealSignedWindowsApp
}

if (require.main === module) {
  const [flag, appDir, signedListFile] = process.argv.slice(2)
  if (flag !== '--reseal-signed' || !appDir || !signedListFile) {
    console.error('usage: packaged-madangd-template.cjs --reseal-signed <appDir> <signedListFile>')
    process.exit(2)
  }
  resealSignedWindowsApp(resolve(appDir), resolve(signedListFile))
}
