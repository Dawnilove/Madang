export function getOrcaCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'madang-ide'
  }
  if (platform === 'win32') {
    return 'madang.cmd'
  }
  return 'madang'
}
