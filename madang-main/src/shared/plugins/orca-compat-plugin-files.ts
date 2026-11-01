// 옛 Orca 플러그인 파일 이름. 새 이름이 없을 때만 읽는다. 새로 만들 때는 쓰지 않는다.
export const ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME = 'orca-plugin.json'
export const ORCA_COMPAT_PLUGIN_MARKETPLACE_FILENAME = 'orca-marketplace.json'
export const ORCA_COMPAT_PLUGIN_RECIPE_FILENAME = 'orca-recipe.json'

/** 파일 이름이 새 이름이나 옛 이름이면 true. 오류 문구 판별용이다. */
export function isPluginManifestFilenameText(text: string): boolean {
  return text.includes('madang-plugin.json') || text.includes(ORCA_COMPAT_PLUGIN_MANIFEST_FILENAME)
}
