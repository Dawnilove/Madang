import type { MadangdManagedStopRequest } from '../../shared/madangd-stop-request'
import { persistMadangdDaemonRetirementRecord } from './madangd-completed-stop-receipt'
import type { MadangdDaemonRetirement } from './madangd-daemon-retirement'
import { stopMadangdAutomationScheduler } from './madangd-automations'
import { holdMadangdTerminalAdmissionUntilExit } from './madangd-stop-terminal-admission'

// Keep daemon imports lazy so entry loading cannot initialize native code.
async function retireLazily(): Promise<MadangdDaemonRetirement> {
  const { retireMadangdDaemonIfIdle } = await import('./madangd-daemon-retirement')
  return retireMadangdDaemonIfIdle()
}

/** Record managed-stop outcomes without vetoing the stop. */
export async function prepareMadangdManagedStop(
  request: MadangdManagedStopRequest,
  retire: () => Promise<MadangdDaemonRetirement> = retireLazily,
  stopAutomations: () => void = stopMadangdAutomationScheduler,
  holdTerminalAdmission: () => void = holdMadangdTerminalAdmissionUntilExit
): Promise<void> {
  // Fence spawns before potentially slow daemon retirement.
  holdTerminalAdmission()
  // Stop dispatch before census so new runs cannot race shutdown.
  stopAutomations()
  if (!request.retireIdleDaemon) {
    return
  }
  const outcome = await retire().catch((error: unknown): MadangdDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: `Retirement failed: ${error instanceof Error ? error.message : String(error)}`
  }))
  try {
    persistMadangdDaemonRetirementRecord(request, outcome)
  } catch (error) {
    // Missing retirement records remain unverifiable to the completion reader.
    console.error('[madangd] could not record daemon retirement:', error)
  }
}
