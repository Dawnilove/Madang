import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MADANGD_PROFILE_PREFLIGHT_FLAG,
  MADANGD_STARTUP_PREFLIGHT_FLAG
} from '../../shared/madangd-profile-preflight'
import {
  MADANGD_CANCEL_MANAGED_STOP_FLAG,
  MADANGD_COMPLETE_MANAGED_STOP_FLAG
} from '../../shared/madangd-stop-request'

// Preflight must precede PTY imports because native loader failures may be uncatchable.
const { order, profileProbe, reserveStdout } = vi.hoisted(() => {
  const order: string[] = []
  return { order, profileProbe: vi.fn(async () => {}), reserveStdout: vi.fn() }
})

vi.mock('../server/serve-stdout-boundary', () => ({
  reserveServeStdoutForReadiness: reserveStdout
}))
vi.mock('./madangd-bundled-runtime', () => ({ assertMadangdServerRuntime: () => {} }))
vi.mock('./madangd-profile-preflight', () => ({
  preflightBundledMadangdStartup: async () => {
    order.push('profile-admission')
  },
  runMadangdProfilePreflight: profileProbe
}))

beforeEach(() => {
  vi.resetModules()
  order.length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

vi.mock('./madangd-native-preflight', () => ({
  runMadangdNativePreflight: () => {
    order.push('preflight')
    return true
  }
}))

vi.mock('./madangd-managed-stop-command', () => ({
  runMadangdManagedStopCommandAndExit: async (argv: string[]) => {
    order.push(`managed-stop:${argv.join(' ')}`)
  }
}))

vi.mock('./madangd-entry', () => ({
  main: vi.fn(async () => {
    order.push('main')
  })
}))

describe('madangd entry', () => {
  it.each([['--help'], ['-h'], ['--json', '--help'], ['--bind', '--help', '-h']])(
    'handles help before startup probes or stdout redirection: %j',
    async (...argv) => {
      vi.spyOn(process, 'argv', 'get').mockReturnValue(['runtime', 'madangd.js', ...argv])
      await import('./main')
      const { main } = await import('./madangd-entry')

      expect(main).toHaveBeenCalledWith(argv)
      expect(order).toEqual(['main'])
      expect(profileProbe).not.toHaveBeenCalled()
      expect(reserveStdout).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['--bind', '--help'],
    ['--pairing-address', '-h'],
    ['--project-root', '--help']
  ])('keeps startup probes when help is consumed as a value: %j', async (...argv) => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['runtime', 'madangd.js', ...argv])
    await import('./main')
    await vi.waitFor(() => expect(order).toContain('main'))

    expect(order).toEqual(['profile-admission', 'preflight', 'main'])
    expect(reserveStdout).toHaveBeenCalledOnce()
  })

  it.each([
    { flag: MADANGD_PROFILE_PREFLIGHT_FLAG, nativeFeatures: true },
    { flag: MADANGD_STARTUP_PREFLIGHT_FLAG, nativeFeatures: false }
  ])(
    'runs the selected disposable probe without starting a server: $flag',
    async ({ flag, nativeFeatures }) => {
      vi.spyOn(process, 'argv', 'get').mockReturnValue(['runtime', 'madangd.js', flag, 'nonce'])
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub only records the call; nothing reads its never return.
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
      await import('./main')
      expect(profileProbe).toHaveBeenCalledExactlyOnceWith('nonce', { nativeFeatures })
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      expect(order).toEqual([])
    }
  )

  it('runs the native preflight before starting the runtime', async () => {
    await import('./main')
    await vi.waitFor(() => expect(order).toContain('main'))

    expect(order).toEqual(['profile-admission', 'preflight', 'main'])
  })

  it.each([MADANGD_COMPLETE_MANAGED_STOP_FLAG, MADANGD_CANCEL_MANAGED_STOP_FLAG])(
    'runs %s without preflights, the bundled handoff, or a runtime',
    async (flag) => {
      vi.spyOn(process, 'argv', 'get').mockReturnValue(['runtime', 'madangd.js', flag, '{}'])
      await import('./main')
      await vi.waitFor(() => expect(order).toHaveLength(1))

      expect(order).toEqual([`managed-stop:${flag} {}`])
    }
  )

  it('runs the Windows breakaway launcher without preflights or a runtime', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue([
      'runtime',
      'madangd.js',
      '--windows-breakaway-launch',
      '--stdout-file',
      'out',
      '--stderr-file',
      'err',
      '--madangd-args',
      '--json'
    ])
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((_chunk: unknown, callback?: unknown) => {
        if (typeof callback === 'function') {
          callback()
        }
        return true
      })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub only records the call; nothing reads its never return.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await import('./main')
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())
    expect(String(write.mock.calls[0]?.[0])).toMatch(/^MADANG_MADANGD_LAUNCH /u)
    expect(order).toEqual([])
  })
})
