import { join } from 'node:path'
import type { BundledSkillCleanup, BundledSkillOp } from '../../../shared/bundled-skill-plan'
import {
  orcaCompatCurrentSkillName,
  orcaCompatLegacySkillNames
} from '../../../shared/skills/orca-compat-skill-names'
import type { BundledSkillSource } from './bundled-skill-sources'
import { hasCloudReceipt, stateKeysFor } from './cloud-state'
import { classifyBundledSkillPath } from './classify'
import type { BundledSkillFilesystem } from './filesystem'
import { bundledSkillPathKey, type BundledSkillTargetRoot } from './targets'

/** No real digest is empty, so no folder counts as the current copy of the old name. */
const NO_CURRENT_DIGEST = ''

/**
 * 옛 Orca 이름으로 앱이 설치한 폴더를 백업 대상으로 고른다.
 * 내용이 출시본과 정확히 같은 폴더만 고른다. 사용자가 고친 폴더·직접 만든 폴더는 두고 간다.
 * 공유 폴더의 옛 사본을 가리키는 링크도 함께 고른다. 안 그러면 링크가 끊긴다.
 */
async function legacyNameCleanups(
  filesystem: BundledSkillFilesystem,
  stateDirectory: string,
  root: BundledSkillTargetRoot,
  source: BundledSkillSource,
  sharedRealRoot: string | null
): Promise<BundledSkillCleanup[]> {
  const cleanups: BundledSkillCleanup[] = []
  for (const legacyName of orcaCompatLegacySkillNames(source.name)) {
    const path = join(root.path, legacyName)
    const classified = await classifyBundledSkillPath(
      filesystem,
      path,
      source,
      NO_CURRENT_DIGEST,
      true
    )
    const { observed } = classified
    if (classified.folderClass === 'released') {
      const keys = stateKeysFor(path, join(root.realPath, legacyName))
      if (!(await hasCloudReceipt(stateDirectory, keys))) {
        cleanups.push({ path, action: 'backup', observed })
      }
    } else if (observed.kind === 'link' && sharedRealRoot) {
      const sharedLegacy = join(sharedRealRoot, legacyName)
      const target = await filesystem.realpath(path)
      const sharedClass = await classifyBundledSkillPath(
        filesystem,
        sharedLegacy,
        source,
        NO_CURRENT_DIGEST
      )
      if (
        target &&
        bundledSkillPathKey(target) === bundledSkillPathKey(sharedLegacy) &&
        sharedClass.folderClass === 'released'
      ) {
        cleanups.push({ path, action: 'backup', observed })
      }
    }
  }
  return cleanups
}

type LegacyCleanupContext = {
  filesystem: BundledSkillFilesystem
  stateDirectory: string
  root: BundledSkillTargetRoot
  source: BundledSkillSource
}

/**
 * 옛 이름 사본은 새 이름 설치가 실제로 일어날 때만 정리한다. 안 그러면 스킬이 사라진다.
 * installedOnly(update)는 새 위치를 만들지 않으므로 옛 이름만 있는 곳은 옮기지 않는다.
 */
export async function withLegacyCleanups(
  op: BundledSkillOp,
  { filesystem, stateDirectory, root, source }: LegacyCleanupContext,
  sharedRealRoot: string | null
): Promise<BundledSkillOp> {
  if (op.kind === 'leave') {
    return op
  }
  const legacy = await legacyNameCleanups(filesystem, stateDirectory, root, source, sharedRealRoot)
  return legacy.length ? { ...op, cleanup: [...op.cleanup, ...legacy] } : op
}

/** 이름으로 번들 스킬을 찾는다. 옛 Orca 이름도 새 이름의 스킬로 찾는다. */
export function findBundledSkillSource(
  sources: readonly BundledSkillSource[],
  name: string
): BundledSkillSource {
  const source = sources.find((candidate) => candidate.name === orcaCompatCurrentSkillName(name))
  if (!source) {
    throw new Error(`bundled-skill-unknown: ${name}`)
  }
  return source
}
