// 옛 Orca 스킬 이름은 이 파일에만 적는다. 새 이름으로 바꾸는 이전 단계가 읽는다.
// config/scripts/*.mjs 도 이 파일을 직접 읽는다. 그래서 Node 타입 제거로 실행되는 문법만 쓴다.

/** 옛 이름 -> 새 이름. 목록에 더하기만 하고 빼지 않는다. 설치된 옛 폴더를 찾는 데 쓴다. */
export const ORCA_COMPAT_SKILL_NAME_MAP = {
  'orca-cli': 'madang-cli',
  'orca-linear': 'madang-linear',
  'orca-jira': 'madang-jira',
  'orca-emulator': 'madang-emulator',
  'orca-emulator-android': 'madang-emulator-android',
  'orca-per-workspace-env': 'madang-per-workspace-env'
} as const

/** 새 이름 스킬의 옛 이름 목록. 옛 이름이 없으면 빈 배열. */
export function orcaCompatLegacySkillNames(currentName: string): string[] {
  return Object.entries(ORCA_COMPAT_SKILL_NAME_MAP)
    .filter(([, current]) => current === currentName)
    .map(([legacy]) => legacy)
}

/** 옛 이름이면 새 이름, 아니면 받은 이름 그대로. */
export function orcaCompatCurrentSkillName(name: string): string {
  return Object.hasOwn(ORCA_COMPAT_SKILL_NAME_MAP, name)
    ? ORCA_COMPAT_SKILL_NAME_MAP[name as keyof typeof ORCA_COMPAT_SKILL_NAME_MAP]
    : name
}
