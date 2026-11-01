import { describe, expect, it } from 'vitest'
import {
  ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME,
  ORCA_COMPAT_PLUGIN_MARKETPLACE_FILENAME,
  ORCA_COMPAT_PLUGIN_RECIPE_FILENAME,
  isPluginManifestFilenameText
} from './orca-compat-plugin-files'
import { PLUGIN_MANIFEST_FILENAME } from './plugin-manifest'
import { PLUGIN_MARKETPLACE_FILENAME } from './plugin-marketplace'

describe('orca-compat-plugin-files', () => {
  it('keeps the old Orca names fixed', () => {
    expect(ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME).toBe('orca-plugin.json')
    expect(ORCA_COMPAT_PLUGIN_MARKETPLACE_FILENAME).toBe('orca-marketplace.json')
    expect(ORCA_COMPAT_PLUGIN_RECIPE_FILENAME).toBe('orca-recipe.json')
  })

  it('uses the Madang names for new files', () => {
    expect(PLUGIN_MANIFEST_FILENAME).toBe('madang-plugin.json')
    expect(PLUGIN_MARKETPLACE_FILENAME).toBe('madang-marketplace.json')
  })

  it('recognizes both manifest names in error text', () => {
    expect(isPluginManifestFilenameText('missing madang-plugin.json')).toBe(true)
    expect(isPluginManifestFilenameText('unreadable orca-plugin.json: x')).toBe(true)
    expect(isPluginManifestFilenameText('something else')).toBe(false)
  })
})
