import { useSyncExternalStore } from 'react'
import type {
  BundledSkillInstallResult,
  BundledSkillPlan,
  BundledSkillPlanRequest
} from '../../../shared/bundled-skill-plan'
import {
  BUNDLED_SKILL_LEAVE_REASON_TEXT,
  bundledSkillPlanState
} from '../../../shared/bundled-skill-summary'

/** Install state of the `collaboration` skill on this machine; kept apart from the setting so a failed install stays visible. */
export type CollaborationSkillState =
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'installed' }
  | { kind: 'failed'; reason: string }

export type BundledSkillApi = {
  bundledPlan: (request: BundledSkillPlanRequest) => Promise<BundledSkillPlan>
  bundledExecute: (request: {
    planDigest: string
    request: BundledSkillPlanRequest
  }) => Promise<BundledSkillInstallResult>
}

const COLLABORATION_REQUEST: BundledSkillPlanRequest = { names: ['collaboration'] }
const LEGACY_CLI_REQUEST: BundledSkillPlanRequest = { names: ['madang-cli'] }

let state: CollaborationSkillState = { kind: 'unknown' }
let running: Promise<CollaborationSkillState> | null = null
const listeners = new Set<() => void>()

function setState(next: CollaborationSkillState): CollaborationSkillState {
  state = next
  listeners.forEach((listener) => listener())
  return next
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every op already matches the shipped copy (or another owner's same-named skill). */
function planIsCurrent(plan: BundledSkillPlan): boolean {
  return plan.skills.length > 0 && plan.skills.every((entry) => bundledSkillPlanState(entry) === 'current')
}

/** Why the plan still is not current: a failed op's error, else the first left-alone reason. */
export function collaborationInstallProblem(
  plan: BundledSkillPlan,
  result: BundledSkillInstallResult | null
): string {
  for (const skill of result?.skills ?? []) {
    if (skill.status !== 'ran') {
      return skill.status === 'busy' ? BUNDLED_SKILL_LEAVE_REASON_TEXT.busy : 'The skill folder changed during install'
    }
    const failed = skill.ops.find((op) => op.status === 'failed')
    if (failed) {
      return `${failed.path}: ${failed.error ?? 'install failed'}`
    }
  }
  for (const entry of plan.skills) {
    const left = entry.ops.find((op) => op.kind === 'leave' && op.reason)
    if (left?.reason) {
      return `${left.path}: ${BUNDLED_SKILL_LEAVE_REASON_TEXT[left.reason] ?? left.reason}`
    }
  }
  return plan.skills.length === 0 ? 'No agent folder to install into' : 'Install did not complete'
}

async function runEnsure(api: BundledSkillApi): Promise<CollaborationSkillState> {
  const before = await api.bundledPlan(COLLABORATION_REQUEST)
  if (planIsCurrent(before)) {
    return { kind: 'installed' }
  }
  const result = await api.bundledExecute({
    planDigest: before.planDigest,
    request: COLLABORATION_REQUEST
  })
  // Re-plan so the state reflects the disk, not the executor's own report.
  const after = await api.bundledPlan(COLLABORATION_REQUEST)
  return planIsCurrent(after)
    ? { kind: 'installed' }
    : { kind: 'failed', reason: collaborationInstallProblem(after, result) }
}

/** Idempotent: installs the stub when missing and records the outcome. Concurrent callers share one run. */
export function ensureCollaborationSkill(
  api: BundledSkillApi = window.api.skills
): Promise<CollaborationSkillState> {
  if (running) {
    return running
  }
  setState({ kind: 'checking' })
  running = runEnsure(api)
    .catch((error: unknown) => ({ kind: 'failed' as const, reason: errorText(error) }))
    .then(setState)
    .finally(() => {
      running = null
    })
  return running
}

/**
 * Replace app-installed legacy `orca-cli` copies with `madang-cli`.
 * Runs only when the plan backs up a legacy copy, so a machine without one gets no new skill.
 */
export async function migrateLegacyCliSkill(
  api: BundledSkillApi = window.api.skills
): Promise<boolean> {
  const plan = await api.bundledPlan(LEGACY_CLI_REQUEST)
  const hasLegacy = plan.skills.some((entry) =>
    entry.ops.some((op) => op.cleanup.some((cleanup) => /[\\/]orca-cli$/u.test(cleanup.path)))
  )
  if (!hasLegacy) {
    return false
  }
  await api.bundledExecute({ planDigest: plan.planDigest, request: LEGACY_CLI_REQUEST })
  return true
}

export function useCollaborationSkillState(): CollaborationSkillState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => state
  )
}

/** Test seam. */
export function resetCollaborationSkillStateForTest(): void {
  state = { kind: 'unknown' }
  running = null
}
