import { writeMadangdActivationRecord } from '../activation/madangd-activation-record-store'
import type { MadangdActivationRecoveryResult } from '../activation/madangd-activation-recovery'
import type { MadangdDecommissionRecoveryPlan } from './madangd-decommission-transaction'
import { settleMadangdDecommissionStop } from './madangd-decommission-stop'
import {
  madangdLivenessProbeCommand,
  madangdLivenessProvenExited,
  parseMadangdLiveness
} from '../install/madangd-remote-launch'
import { execMadangdRemote } from '../install/madangd-remote-runtime-control'
import {
  ensureMadangdSlotServing,
  madangdSlotDir,
  resolveMadangdSlotIdentity,
  type MadangdSlotOptions
} from '../../ssh/madangd-recovery-slot'

/** Only proven exit clears an interrupted decommission journal. */
export async function reconcileMadangdDecommission(
  options: MadangdSlotOptions,
  plan: MadangdDecommissionRecoveryPlan
): Promise<MadangdActivationRecoveryResult> {
  if (plan.action === 'keep-serving') {
    const identity = await resolveMadangdSlotIdentity(options, plan.version)
    return {
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: plan.version,
      readiness: await ensureMadangdSlotServing(options, identity)
    }
  }
  if (plan.action === 'resume-stop') {
    const settlement = await settleMadangdDecommissionStop(options, plan.request)
    if (settlement.state === 'unsettled') {
      return {
        outcome: 'refused',
        verdict: settlement.verdict,
        code: 'madangd_recovery_decommission_unsettled',
        reason: settlement.reason
      }
    }
    if (settlement.state === 'withdrawn') {
      return reconcileMadangdDecommission(options, {
        action: 'keep-serving',
        version: plan.request.version
      })
    }
    return reconcileMadangdDecommission(options, {
      action: 'confirm-decommissioned',
      version: plan.request.version,
      record: plan.record
    })
  }
  // Live or unanswered slots retain the fence; only proven exit permits commit.
  const liveness = parseMadangdLiveness(
    await execMadangdRemote(
      options,
      madangdLivenessProbeCommand(options.host, madangdSlotDir(options, plan.version))
    )
  )
  if (!madangdLivenessProvenExited(liveness)) {
    return {
      outcome: 'refused',
      verdict: liveness === 'LIVE' ? 'live' : 'unverifiable',
      code: 'madangd_recovery_decommissioned_slot_not_exited',
      reason: `madangd ${plan.version} is recorded as stopped but is ${liveness.toLowerCase()}.`
    }
  }
  if (plan.record) {
    await writeMadangdActivationRecord(options, plan.record)
  }
  return { outcome: 'recovered', resolution: 'committed', activeVersion: null, readiness: null }
}
