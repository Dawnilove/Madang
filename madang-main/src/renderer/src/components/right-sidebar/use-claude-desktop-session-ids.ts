import { useEffect, useState } from 'react'
import type { ClaudeDesktopActiveSession } from '../../../../shared/ai-vault-types'

export type ClaudeDesktopIdSets = {
  archived: ReadonlySet<string>
  known: ReadonlySet<string>
  cwds: ReadonlyMap<string, string>
  active: readonly ClaudeDesktopActiveSession[]
}

// 보관 상태는 Orca 세션 파일과 따로 바뀐다. 패널을 열 때와 창이 다시 포커스될 때 읽는다.
export function useClaudeDesktopSessionIds(): ClaudeDesktopIdSets | undefined {
  const [ids, setIds] = useState<ClaudeDesktopIdSets>()
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void Promise.resolve(window.api.aiVault.listClaudeDesktopSessionIds?.())
        .then((list) => {
          if (!cancelled && list) {
            setIds({
              archived: new Set(list.archived),
              known: new Set(list.known),
              cwds: new Map(Object.entries(list.cwds ?? {})),
              active: list.active ?? []
            })
          }
        })
        // 읽기에 실패하면 숨기지 않고 모두 보여 준다.
        .catch(() => {})
    }
    load()
    const unsubscribe = window.api.aiVault.onWindowFocused?.(load)
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])
  return ids
}
