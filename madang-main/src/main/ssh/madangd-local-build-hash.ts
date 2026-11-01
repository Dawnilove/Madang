import { join } from 'node:path'
import { hashMadangdLauncher } from '../../shared/madangd-build-identity'
import { MADANGD_LAUNCHER_FILENAME } from '../../shared/madangd-artifacts'

export function computeLocalMadangdBuildHash(localMadangdDir: string): string {
  return hashMadangdLauncher(join(localMadangdDir, MADANGD_LAUNCHER_FILENAME))
}
