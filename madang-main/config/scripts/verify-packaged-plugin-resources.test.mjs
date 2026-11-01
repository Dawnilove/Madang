import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { verifyPackagedPluginResources } = require('./verify-packaged-plugin-resources.cjs')

async function withLaunchRoot(index, run) {
  const resourcesDir = await mkdtemp(join(tmpdir(), 'madang-packaged-plugins-'))
  try {
    const launchRoot = join(resourcesDir, 'plugins', 'launch')
    await mkdir(launchRoot, { recursive: true })
    await writeFile(join(launchRoot, 'bundled-plugins.json'), JSON.stringify(index))
    await run(resourcesDir, launchRoot)
  } finally {
    await rm(resourcesDir, { recursive: true, force: true })
  }
}

describe('verify packaged plugin resources', () => {
  it('accepts the launch directory copied into a packaged resources directory', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'madang-packaged-plugins-'))
    try {
      await cp(
        join(process.cwd(), 'resources', 'plugins', 'launch'),
        join(resourcesDir, 'plugins', 'launch'),
        { recursive: true }
      )

      expect(() => verifyPackagedPluginResources(resourcesDir)).not.toThrow()
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('rejects a malformed bundled plugin index', async () => {
    await withLaunchRoot({ version: 1 }, (resourcesDir) => {
      expect(() => verifyPackagedPluginResources(resourcesDir)).toThrow('index is invalid')
    })
  })

  it('reads the old Orca manifest name when the new name is absent', async () => {
    const entry = {
      pluginKey: 'dawnilove.madang-sample',
      path: 'dawnilove.madang-sample',
      contentHash: '0'.repeat(64)
    }
    await withLaunchRoot({ version: 1, plugins: [entry] }, async (resourcesDir, launchRoot) => {
      await mkdir(join(launchRoot, entry.path))
      await writeFile(
        join(launchRoot, entry.path, 'orca-plugin.json'),
        JSON.stringify({ publisher: 'dawnilove', id: 'madang-sample' })
      )
      // 이름 읽기가 성공해야 해시 비교 단계까지 간다.
      expect(() => verifyPackagedPluginResources(resourcesDir)).toThrow(
        'packaged bytes do not match dawnilove.madang-sample'
      )
    })
  })

  it('rejects packaged bytes that do not match the recorded hash', async () => {
    const entry = {
      pluginKey: 'dawnilove.madang-sample',
      path: 'dawnilove.madang-sample',
      contentHash: '0'.repeat(64)
    }
    await withLaunchRoot({ version: 1, plugins: [entry] }, async (resourcesDir, launchRoot) => {
      await mkdir(join(launchRoot, entry.path))
      await writeFile(
        join(launchRoot, entry.path, 'madang-plugin.json'),
        JSON.stringify({ publisher: 'dawnilove', id: 'madang-sample' })
      )
      expect(() => verifyPackagedPluginResources(resourcesDir)).toThrow(
        'packaged bytes do not match dawnilove.madang-sample'
      )
    })
  })
})
