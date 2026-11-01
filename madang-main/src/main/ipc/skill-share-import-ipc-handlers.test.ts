import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>()
const showSaveDialog = vi.hoisted(() => vi.fn())
const showOpenDialog = vi.hoisted(() => vi.fn())
const inspectMock = vi.hoisted(() => vi.fn())
const githubMock = vi.hoisted(() => vi.fn())
const compatMock = vi.hoisted(() => vi.fn())
const exportMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { once: vi.fn(), getPath: () => 'C:/user-data' },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog, showOpenDialog }
}))
vi.mock('./skill-ipc-main-window', () => ({
  handleMainWindowSkillIpc: (
    channel: string,
    handler: (event: unknown, value?: unknown) => Promise<unknown>
  ) => handlers.set(channel, handler)
}))
vi.mock('../skills/skill-bundle-file-import', () => ({ inspectSkillBundleFile: inspectMock }))
vi.mock('../skills/skill-github-import', () => ({ importSkillsFromGithub: githubMock }))
vi.mock('../skills/skill-compat-share-import', () => ({
  importSkillsFromCompatShare: compatMock
}))
vi.mock('../skills/skill-bundle-file-export', () => ({
  exportSkillBundle: exportMock,
  skillExportErrorCode: () => 'failed'
}))

const { registerSkillShareImportIpcHandlers } = await import('./skill-share-import-ipc-handlers')

const DIGEST = 'c'.repeat(64)
const event = { sender: { isDestroyed: () => true } }

function bundle(path: string) {
  return {
    archivePath: path,
    cleanup: vi.fn().mockResolvedValue(undefined),
    version: {
      packageId: 'pkg_1',
      versionId: 'ver_1',
      name: 'team',
      description: '',
      packageDigest: DIGEST,
      archiveSha256: 'b'.repeat(64),
      compressedBytes: 10,
      createdAt: '2026-08-11T00:00:00.000Z',
      releaseNotes: '',
      manifest: {
        schemaVersion: 1,
        packageId: 'pkg_1',
        versionId: 'ver_1',
        bundleName: 'team',
        description: '',
        createdAt: '2026-08-11T00:00:00.000Z',
        skills: [{ id: 'alpha', name: 'alpha', description: '', digest: DIGEST, files: [] }],
        bundleDigest: DIGEST
      }
    }
  }
}

async function call(
  channel: string,
  value?: unknown
): Promise<Record<string, unknown> & { importId: string }> {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return (await handler(event, value)) as Record<string, unknown> & { importId: string }
}

const runtime = { installSharedSkillBundleRequest: vi.fn() }
const discover = vi.fn()

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()
  registerSkillShareImportIpcHandlers(runtime as never, discover)
})

describe('skill share import IPC', () => {
  it('rejects bad addresses before touching the network', async () => {
    await expect(call('skills:importGithub', { url: 'https://gitlab.com/o/r' })).resolves.toEqual({
      status: 'error',
      code: 'invalid-url'
    })
    await expect(
      call('skills:importCompatShare', { link: 'https://evil.example/skills/share/abc' })
    ).resolves.toEqual({ status: 'error', code: 'invalid-url' })
    expect(githubMock).not.toHaveBeenCalled()
    expect(compatMock).not.toHaveBeenCalled()
  })

  it('returns nothing when the open dialog is cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(call('skills:importBundleFile', {})).resolves.toEqual({ status: 'cancelled' })
    expect(inspectMock).not.toHaveBeenCalled()
  })

  it('installs a staged bundle from the path the registry holds, and only for this computer', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/picked/team.tar.gz'] })
    inspectMock.mockResolvedValue(bundle('C:/picked/team.tar.gz'))
    runtime.installSharedSkillBundleRequest.mockResolvedValue({ status: 'complete', skills: [] })
    const staged = await call('skills:importBundleFile', {})
    expect(staged.status).toBe('ready')

    const base = {
      importId: staged.importId,
      selectedSkillIds: ['alpha'],
      destination: { scope: 'global' }
    }
    await expect(
      call('skills:installImportedBundle', { ...base, environmentId: 'env_remote' })
    ).resolves.toMatchObject({ status: 'unsupported' })
    expect(runtime.installSharedSkillBundleRequest).not.toHaveBeenCalled()

    await expect(call('skills:installImportedBundle', base)).resolves.toMatchObject({
      status: 'ok'
    })
    const [request, , , options] = runtime.installSharedSkillBundleRequest.mock.calls[0]
    expect(request.ingress).toEqual({ kind: 'local-file', path: 'C:/picked/team.tar.gz' })
    expect(request.package.archiveSha256).toBe('b'.repeat(64))
    expect(options).toEqual({ allowTrustedLocalFile: true })
  })

  it('refuses ids it never staged and paths sent by the page', async () => {
    await expect(
      call('skills:installImportedBundle', {
        importId: '22222222-2222-4222-8222-222222222222',
        selectedSkillIds: ['alpha'],
        destination: { scope: 'global' }
      })
    ).rejects.toThrow('skill-import-expired')
    await expect(
      call('skills:installImportedBundle', {
        importId: '22222222-2222-4222-8222-222222222222',
        selectedSkillIds: ['alpha'],
        destination: { scope: 'global' },
        path: 'C:/anything.tar.gz'
      })
    ).rejects.toThrow()
  })

  it('removes a staged bundle when released', async () => {
    const staged = bundle('C:/tmp/github/bundle.tar.gz')
    githubMock.mockResolvedValue({ ...staged, skippedCount: 0 })
    const result = await call('skills:importGithub', { url: 'https://github.com/o/r' })
    await call('skills:releaseImport', result.importId)
    expect(staged.cleanup).toHaveBeenCalled()
    await expect(
      call('skills:installImportedBundle', {
        importId: result.importId,
        selectedSkillIds: ['alpha'],
        destination: { scope: 'global' }
      })
    ).rejects.toThrow('skill-import-expired')
  })

  it('writes nothing when the save dialog is cancelled', async () => {
    discover.mockResolvedValue({
      skills: [{ id: 'mine', name: 'mine', directoryPath: 'C:/s/mine' }]
    })
    showSaveDialog.mockResolvedValue({ canceled: true })
    await expect(
      call('skills:exportBundle', { skillIds: ['mine'], bundleName: 'mine' })
    ).resolves.toEqual({ status: 'cancelled' })
    expect(exportMock).not.toHaveBeenCalled()
  })

  it('adds the .tar.gz ending to the chosen file name', async () => {
    discover.mockResolvedValue({
      skills: [{ id: 'mine', name: 'mine', directoryPath: 'C:/s/mine' }]
    })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:/out/mine' })
    exportMock.mockResolvedValue({})
    await expect(
      call('skills:exportBundle', { skillIds: ['mine'], bundleName: 'mine' })
    ).resolves.toEqual({ status: 'saved', path: 'C:/out/mine.tar.gz', skillCount: 1 })
    expect(exportMock).toHaveBeenCalledWith(
      expect.objectContaining({ archivePath: 'C:/out/mine.tar.gz' })
    )
  })
})
