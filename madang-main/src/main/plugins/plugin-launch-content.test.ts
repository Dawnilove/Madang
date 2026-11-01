import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapBundledPlugins, resolveBundledPluginRoot } from './plugin-bundled-bootstrap'

const launchRoot = join(process.cwd(), 'resources', 'plugins', 'launch')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('launch plugin content', () => {
  it('ships an empty bundled plugin index (Madang bundles no plugins)', async () => {
    const index = JSON.parse(await readFile(join(launchRoot, 'bundled-plugins.json'), 'utf8'))
    expect(index).toEqual({ version: 1, plugins: [] })
  })

  it('boots the empty index from the packaged resources layout', async () => {
    const resourcesPath = await mkdtemp(join(tmpdir(), 'madang-packaged-resources-'))
    const userDataPath = await mkdtemp(join(tmpdir(), 'madang-packaged-user-data-'))
    temporaryRoots.push(resourcesPath, userDataPath)
    await cp(launchRoot, join(resourcesPath, 'plugins', 'launch'), { recursive: true })

    const result = await bootstrapBundledPlugins({
      root: resolveBundledPluginRoot({
        isPackaged: true,
        resourcesPath,
        appPath: join(resourcesPath, 'app.asar')
      }),
      userDataPath,
      hostVersion: '1.4.0'
    })

    expect(result).toEqual({ installed: [], unchanged: [], errors: [] })
  })
})
