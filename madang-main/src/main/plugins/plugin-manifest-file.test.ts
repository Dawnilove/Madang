import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME,
  ORCA_COMPAT_PLUGIN_MARKETPLACE_FILENAME
} from '../../shared/plugins/orca-compat-plugin-files'
import { PLUGIN_MANIFEST_FILENAME } from '../../shared/plugins/plugin-manifest'
import { PLUGIN_MARKETPLACE_FILENAME } from '../../shared/plugins/plugin-marketplace'
import { discoverPlugins, isInvalidDiscoveredPlugin } from './plugin-discovery'
import { installPluginFromLocalPath } from './plugin-install'
import { readPluginManifestText, resolvePluginManifestFilename } from './plugin-manifest-file'
import { readPluginMarketplaceIndex } from './plugin-marketplace-fetch'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'madang-plugin-files-'))
  roots.push(root)
  return root
}

function manifest(name: string): string {
  return JSON.stringify({
    manifestVersion: 1,
    id: 'demo',
    publisher: 'orca-samples',
    name,
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { panels: [], commands: [], events: [] },
    capabilities: []
  })
}

function marketplace(name: string): string {
  return JSON.stringify({ name, owner: 'tester', plugins: [] })
}

describe('plugin manifest file name', () => {
  it('reads a plugin that only has the new name', async () => {
    const root = await tempDir()
    await writeFile(join(root, PLUGIN_MANIFEST_FILENAME), manifest('New'))
    expect(resolvePluginManifestFilename(root)).toBe(PLUGIN_MANIFEST_FILENAME)
    expect(JSON.parse(await readPluginManifestText(root)).name).toBe('New')
  })

  it('reads a plugin that only has the old Orca name', async () => {
    const root = await tempDir()
    await writeFile(join(root, ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME), manifest('Old'))
    expect(resolvePluginManifestFilename(root)).toBe(ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME)
    expect(JSON.parse(await readPluginManifestText(root)).name).toBe('Old')
  })

  it('prefers the new name when both files exist', async () => {
    const root = await tempDir()
    await writeFile(join(root, PLUGIN_MANIFEST_FILENAME), manifest('New'))
    await writeFile(join(root, ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME), manifest('Old'))
    expect(JSON.parse(await readPluginManifestText(root)).name).toBe('New')
  })

  it('reports the new name when neither file exists', async () => {
    const root = await tempDir()
    expect(resolvePluginManifestFilename(root)).toBe(PLUGIN_MANIFEST_FILENAME)
    await expect(readPluginManifestText(root)).rejects.toThrow()
  })

  it('discovers a dev plugin that only has the old name', async () => {
    const root = await tempDir()
    await writeFile(join(root, ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME), manifest('Old'))
    const [plugin] = await discoverPlugins({
      pluginsDir: join(root, 'none'),
      devPluginPaths: [root],
      hostVersion: '1.4.0'
    })
    expect(plugin && isInvalidDiscoveredPlugin(plugin)).toBe(false)
    expect(plugin?.pluginKey).toBe('orca-samples.demo')
  })

  it('names the missing new file in the discovery error', async () => {
    const root = await tempDir()
    const [plugin] = await discoverPlugins({
      pluginsDir: join(root, 'none'),
      devPluginPaths: [root],
      hostVersion: '1.4.0'
    })
    expect(plugin && 'error' in plugin ? plugin.error : '').toBe(
      `missing ${PLUGIN_MANIFEST_FILENAME}`
    )
  })

  it('installs a local plugin that only has the old name', async () => {
    const source = await tempDir()
    const pluginsDir = await tempDir()
    await writeFile(join(source, ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME), manifest('Old'))
    const result = await installPluginFromLocalPath({
      pluginsDir,
      sourcePath: source,
      hostVersion: '1.4.0'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    // 설치된 사본도 옛 이름 그대로여서 해시가 바뀌지 않고, 다시 발견된다.
    await expect(
      readFile(
        join(
          pluginsDir,
          result.pluginKey,
          result.contentHash,
          ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME
        ),
        'utf8'
      )
    ).resolves.toContain('Old')
    const found = await discoverPlugins({ pluginsDir, devPluginPaths: [], hostVersion: '1.4.0' })
    expect(found.map((plugin) => plugin.pluginKey)).toEqual([result.pluginKey])
    expect(found.some(isInvalidDiscoveredPlugin)).toBe(false)
  })

  it('rejects a local source with neither name', async () => {
    const source = await tempDir()
    const result = await installPluginFromLocalPath({
      pluginsDir: await tempDir(),
      sourcePath: source,
      hostVersion: '1.4.0'
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain(`no ${PLUGIN_MANIFEST_FILENAME} found`)
  })
})

describe('marketplace file name', () => {
  it('reads the new name, the old Orca name, and prefers the new name', async () => {
    const onlyNew = await tempDir()
    await writeFile(join(onlyNew, PLUGIN_MARKETPLACE_FILENAME), marketplace('New'))
    expect((await readPluginMarketplaceIndex(onlyNew)).name).toBe('New')

    const onlyOld = await tempDir()
    await writeFile(join(onlyOld, ORCA_COMPAT_PLUGIN_MARKETPLACE_FILENAME), marketplace('Old'))
    expect((await readPluginMarketplaceIndex(onlyOld)).name).toBe('Old')

    const both = await tempDir()
    await writeFile(join(both, PLUGIN_MARKETPLACE_FILENAME), marketplace('New'))
    await writeFile(join(both, ORCA_COMPAT_PLUGIN_MARKETPLACE_FILENAME), marketplace('Old'))
    expect((await readPluginMarketplaceIndex(both)).name).toBe('New')
  })

  it('still validates an old-name file strictly', async () => {
    const root = await tempDir()
    await mkdir(root, { recursive: true })
    await writeFile(join(root, ORCA_COMPAT_PLUGIN_MARKETPLACE_FILENAME), '{"name":1}')
    await expect(readPluginMarketplaceIndex(root)).rejects.toThrow()
  })
})
