import { markdownParserAliases } from './config/build-plugins/markdown-parser-exports'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { bytecodePlugin, defineConfig, type UserConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createBootstrapFatalExitBanner } from './config/build-plugins/bootstrap-fatal-exit-banner'
import { createPdfjsViewerAssetsPlugin } from './config/build-plugins/pdfjs-viewer-assets'
import { createProcessHostDevRebuildPlugin } from './config/build-plugins/process-host-dev-rebuild'
import { createViteCacheRetentionPlugin } from './config/build-plugins/vite-cache-retention'
import { MAIN_BUILD_ENTRY_POINTS } from './config/build-plugins/main-build-entry-points'
import { createPlainNodeEntryGuardPlugin } from './config/build-plugins/plain-node-entry-guard'
import { createMainOnlyBytecodeSelection } from './config/build-plugins/main-only-bytecode-selection'
import { createDevServeConfig } from './config/build-plugins/dev-serve-config'
import { resolveBuildSourceCommit } from './config/scripts/build-source-commit.mjs'

const BUNDLED_MAIN_DEPENDENCIES = new Set([
  'stream-json',
  'stream-chain',
  '@xterm/headless',
  '@xterm/addon-serialize',
  'tldts',
  'smol-toml',
  'fflate',
  // Linear save confirmation; bundled like madangd so packaging needs no extra node_modules.
  'unified',
  'remark-parse',
  'remark-gfm',
  // Windows NSIS copies app.asar before external resources; bootstrap must not race resources/node_modules.
  'zod'
])
// Official CI alone injects MADANG_BUILD_IDENTITY (stable|rc) and MADANG_POSTHOG_WRITE_KEY secrets; other builds substitute literal null.
// Compile-time substitution gates telemetry at module load without runtime env fallback; declarations live in src/types/build-constants.d.ts.
const orcaBuildIdentity = process.env.MADANG_BUILD_IDENTITY
const ORCA_BUILD_IDENTITY_LITERAL =
  orcaBuildIdentity === 'stable' || orcaBuildIdentity === 'rc'
    ? JSON.stringify(orcaBuildIdentity)
    : 'null'
// `company` removes token-reading usage meters, agent-settings hooks and the public update feed (src/shared/madang-edition.ts).
const MADANG_EDITION_LITERAL = JSON.stringify(
  process.env.MADANG_EDITION === 'company' ? 'company' : 'standard'
)
const orcaPostHogWriteKey = process.env.MADANG_POSTHOG_WRITE_KEY
const ORCA_POSTHOG_WRITE_KEY_LITERAL =
  typeof orcaPostHogWriteKey === 'string' && orcaPostHogWriteKey.length > 0
    ? JSON.stringify(orcaPostHogWriteKey)
    : 'null'
const orcaDiagnosticsTokenUrl = process.env.MADANG_DIAGNOSTICS_TOKEN_URL
const ORCA_DIAGNOSTICS_TOKEN_URL_LITERAL =
  typeof orcaDiagnosticsTokenUrl === 'string' && orcaDiagnosticsTokenUrl.length > 0
    ? JSON.stringify(orcaDiagnosticsTokenUrl)
    : 'null'

const darkBuildSwitches: {
  darkBuildDefines: () => Record<string, string>
  darkBuildMarkers: () => { fileName: string; text: string }[]
} = createRequire(import.meta.url)('./config/dark-build-switches.cjs')
const DARK_BUILD_DEFINES = darkBuildSwitches.darkBuildDefines()

/** Marks a dark switched-on main build so packaging refuses it. */
function createDarkBuildMarkerPlugin(): Plugin {
  return {
    name: 'orca-dark-build-marker',
    generateBundle() {
      for (const marker of darkBuildSwitches.darkBuildMarkers()) {
        this.emitFile({ type: 'asset', fileName: marker.fileName, source: marker.text })
      }
    }
  }
}

// Pin official skill installs to the bundled commit on every channel; main installs, renderer prints the command.
const ORCA_BUILD_COMMIT_LITERAL = JSON.stringify(resolveBuildSourceCommit())

function createStartupDiagnosticsBanner(chunkName: string): string {
  return `
;(() => {
  const env = typeof process !== 'undefined' ? process.env : undefined
  const mode = env?.MADANG_STARTUP_DIAGNOSTICS
  if (mode !== '1' && mode !== 'trace') {
    return
  }
  const safeJson = (value) => {
    try {
      return JSON.stringify(value)
    } catch {
      return '"<unserializable>"'
    }
  }
  let diagnosticFileDescriptor
  let closeSync, openSync, writeSync
  try {
    const fs = require('node:fs')
    closeSync = fs.closeSync
    openSync = fs.openSync
    writeSync = fs.writeSync
  } catch {
    closeSync = undefined
    openSync = undefined
    writeSync = undefined
  }
  const diagnosticFile = env?.MADANG_STARTUP_DIAGNOSTICS_FILE
  if (typeof diagnosticFile === 'string' && diagnosticFile.length > 0 && typeof openSync === 'function') {
    try {
      diagnosticFileDescriptor = openSync(diagnosticFile, 'a', 0o600)
    } catch {
      diagnosticFileDescriptor = undefined
    }
  }
  const writeLine = (message) => {
    try {
      const line = message.endsWith('\\n') ? message : message + '\\n'
      if (typeof writeSync === 'function') {
        writeSync(2, line)
        if (typeof diagnosticFileDescriptor === 'number') {
          writeSync(diagnosticFileDescriptor, line)
        }
      }
    } catch {
      // Diagnostics must never affect startup.
    }
  }
  const chunkName = ${JSON.stringify(chunkName)}
  writeLine('[bootstrap] bundle-enter chunk=' + safeJson(chunkName) + ' pid=' + process.pid + ' ppid=' + process.ppid + ' execPath=' + safeJson(process.execPath) + ' argv=' + safeJson(process.argv) + ' electronRunAsNode=' + safeJson(env?.ELECTRON_RUN_AS_NODE ?? null))
  if (!globalThis.__ORCA_BOOTSTRAP_EXIT_LOG_INSTALLED__) {
    globalThis.__ORCA_BOOTSTRAP_EXIT_LOG_INSTALLED__ = true
    process.once('exit', (code) => {
      writeLine('[bootstrap] process-exit code=' + code)
      if (typeof closeSync === 'function' && typeof diagnosticFileDescriptor === 'number') {
        try {
          closeSync(diagnosticFileDescriptor)
        } catch {
          // Diagnostics must never affect shutdown.
        }
      }
    })
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      const message = error && typeof error === 'object' && 'stack' in error ? error.stack : error
      writeLine('[bootstrap] uncaught-exception origin=' + safeJson(origin) + ' error=' + safeJson(String(message)))
    })
    process.on('unhandledRejection', (reason) => {
      const message = reason && typeof reason === 'object' && 'stack' in reason ? reason.stack : reason
      writeLine('[bootstrap] unhandled-rejection error=' + safeJson(String(message)))
    })
  }
  if (mode === 'trace' && !globalThis.__ORCA_BOOTSTRAP_REQUIRE_TRACE_INSTALLED__) {
    globalThis.__ORCA_BOOTSTRAP_REQUIRE_TRACE_INSTALLED__ = true
    try {
      const Module = require('node:module')
      const originalLoad = Module._load
      const parsedTraceLimit = Number(env?.MADANG_STARTUP_DIAGNOSTICS_TRACE_LIMIT ?? 20000)
      const traceLimit = Number.isFinite(parsedTraceLimit) && parsedTraceLimit > 0 ? parsedTraceLimit : 20000
      let traceLineCount = 0
      let traceLimitReported = false
      const writeTraceLine = (message) => {
        if (traceLineCount >= traceLimit) {
          if (!traceLimitReported) {
            traceLimitReported = true
            writeLine('[bootstrap] require-trace-limit-reached limit=' + safeJson(traceLimit))
          }
          return
        }
        traceLineCount += 1
        writeLine(message)
      }
      Module._load = function (request, parent, isMain) {
        const parentName = parent && parent.filename ? parent.filename : null
        writeTraceLine('[bootstrap] require-start request=' + safeJson(request) + ' parent=' + safeJson(parentName) + ' isMain=' + safeJson(Boolean(isMain)))
        try {
          const result = Reflect.apply(originalLoad, this, arguments)
          writeTraceLine('[bootstrap] require-ok request=' + safeJson(request))
          return result
        } catch (error) {
          const message = error && typeof error === 'object' && 'stack' in error ? error.stack : error
          writeTraceLine('[bootstrap] require-error request=' + safeJson(request) + ' error=' + safeJson(String(message)))
          throw error
        }
      }
    } catch (error) {
      writeLine('[bootstrap] require-trace-install-error error=' + safeJson(String(error)))
    }
  }
})();
`
}

function createMainBootstrapPlugin() {
  return {
    name: 'orca-main-bootstrap',
    generateBundle(_options, bundle) {
      const mainChunk = bundle['index.js']
      if (!mainChunk || mainChunk.type !== 'chunk') {
        return
      }
      if (!mainChunk.moduleIds.some((id) => resolve(id) === MAIN_BUILD_ENTRY_POINTS.index)) {
        throw new Error('Main startup must stay in index.js so __dirname resolves app assets')
      }

      // Source guards run after Rollup’s require prelude, too late to handle missing bootstrap dependencies.
      mainChunk.code =
        createBootstrapFatalExitBanner() +
        createStartupDiagnosticsBanner(mainChunk.fileName) +
        mainChunk.code
    }
  }
}

// Dev-only unminified main bundle exposes function names in V8 profiles; releases and pnpm build never read this flag.
const MAIN_MINIFY: 'oxc' | false = process.env.MADANG_UNMINIFIED_MAIN === '1' ? false : 'oxc'

// 배포 빌드 보호: MADANG_PROTECT=1이면 Electron 메인 프로세스 전용 코드를 V8 바이트코드로 만든다 (원본 JS가 설치 파일에 남지 않는다).
// 서버·CLI·워커 진입과 그 공용 코드는 일반 Node에서도 실행돼야 하므로 평문으로 둔다.
const mainBytecode = process.env.MADANG_PROTECT === '1' ? createMainOnlyBytecodeSelection() : null

export const electronViteConfig: UserConfig = {
  main: {
    build: {
      // Use Rolldown’s in-process oxc minifier; esbuild mode depends on an undeclared hoisted package.
      minify: MAIN_MINIFY,
      // Hidden maps omit sourceMappingURL because packaging strips them; release CI uploads maps for crash decoding.
      sourcemap: 'hidden',
      // PR fixtures discard maps; official releases must always retain them.
      ...(process.env.MADANG_CI_MAIN_SOURCEMAPS === '0' &&
      orcaBuildIdentity !== 'stable' &&
      orcaBuildIdentity !== 'rc'
        ? { sourcemap: false }
        : {}),
      // Forked daemon-entry.js must be unpacked; its Node resolver cannot reach app.asar, and startup-critical JS must survive partial Windows resource copies.
      externalizeDeps: {
        exclude: [...BUNDLED_MAIN_DEPENDENCIES]
      },
      rollupOptions: {
        input: MAIN_BUILD_ENTRY_POINTS,
        // CLI builds replace exported entries; keep their internals separate without moving startup paths.
        preserveEntrySignatures: 'exports-only',
        // Electron and sidecar launchers require stable CommonJS paths despite Rolldown’s SSR ESM default.
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js'
        },
        plugins: [
          createMainBootstrapPlugin(),
          createPlainNodeEntryGuardPlugin(),
          createProcessHostDevRebuildPlugin(),
          createDarkBuildMarkerPlugin()
        ]
      }
    },
    define: {
      MADANG_BUILD_IDENTITY: ORCA_BUILD_IDENTITY_LITERAL,
      MADANG_EDITION: MADANG_EDITION_LITERAL,
      MADANG_POSTHOG_WRITE_KEY: ORCA_POSTHOG_WRITE_KEY_LITERAL,
      MADANG_DIAGNOSTICS_TOKEN_URL: ORCA_DIAGNOSTICS_TOKEN_URL_LITERAL,
      MADANG_BUILD_COMMIT: ORCA_BUILD_COMMIT_LITERAL,
      ...DARK_BUILD_DEFINES
    },
    // @xterm/headless declares exports:null; point Vite directly at its published CJS main to permit inlining.
    resolve: {
      alias: {
        '@xterm/headless': resolve('node_modules/@xterm/headless/lib-headless/xterm-headless.js'),
        '@xterm/addon-serialize': resolve(
          'node_modules/@xterm/addon-serialize/lib/addon-serialize.js'
        )
      }
    },
    // Vite 플러그인 목록에 둔다: rollupOptions.plugins는 바이트코드 플러그인(enforce: 'post')보다 늦게 돌아 선택이 비어 있다.
    // build.bytecode 옵션으로 넘기면 electron-vite가 옵션을 복제해 chunkAlias가 일반 객체로 바뀐다. 플러그인을 직접 만든다.
    // 화살표 함수 변환은 끈다: babel이 클래스 속성 안의 화살표 함수를 변환하지 못해 빌드가 실패한다.
    plugins: mainBytecode
      ? [
          mainBytecode.plugin,
          bytecodePlugin({ chunkAlias: mainBytecode.chunkAlias, transformArrowFunctions: false })
        ]
      : []
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['zod']
      }
    }
  },
  renderer: {
    // Shared node_modules installs must not share dependency optimization state across worktrees.
    cacheDir: resolve('.cache/vite/renderer'),
    define: {
      MADANG_BUILD_COMMIT: ORCA_BUILD_COMMIT_LITERAL,
      MADANG_EDITION: MADANG_EDITION_LITERAL,
      ...DARK_BUILD_DEFINES
    },
    resolve: {
      alias: {
        ...markdownParserAliases,
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      createPdfjsViewerAssetsPlugin(),
      createViteCacheRetentionPlugin()
    ],
    worker: {
      format: 'es'
    },
    build: {
      manifest: true,
      reportCompressedSize: false,
      modulePreload: { polyfill: true },
      minify: 'oxc',
      target: 'es2020',
      // Give pop-out dashboard its own HTML/React root with shared preload API; retain index or overriding input drops electron-vite’s default entry.
      rollupOptions: {
        // Shared chunks must not import HTML entries that mount another React root.
        preserveEntrySignatures: 'strict',
        input: {
          index: resolve('src/renderer/index.html'),
          popout: resolve('src/renderer/popout.html'),
          space: resolve('src/renderer/space.html'),
          web: resolve('src/renderer/web-index.html')
        }
      }
    }
  }
}

export default defineConfig(({ command }) =>
  command === 'serve' ? createDevServeConfig(electronViteConfig) : electronViteConfig
)
