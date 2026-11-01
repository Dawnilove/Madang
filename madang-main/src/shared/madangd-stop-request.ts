/** Stop files reach only the watching madangd; signals from stale PID records could stop an unrelated reused process. */
import { z } from 'zod'
import { openEnum } from './zod-salvage'

/** Plain request in the slot directory: the same graceful stop as SIGTERM. */
export const MADANGD_STOP_REQUEST_FILENAME = '.madangd-stop-request'
/** Prefix of an instance-bound request in the data root; older listeners never match it. */
export const MADANGD_MANAGED_STOP_REQUEST_PREFIX = '.madangd-managed-stop-request'
export const MADANGD_MANAGED_STOP_REQUEST_MAX_BYTES = 32 * 1024
export const MADANGD_STOP_RECEIPTS_DIRNAME = 'madangd-stop-receipts'
export const MADANGD_COMPLETE_MANAGED_STOP_FLAG = '--complete-managed-stop'
/** Names a staged request file instead of inline JSON; Windows hosts never put the JSON on argv. */
export const MADANGD_MANAGED_STOP_REQUEST_FILE_FLAG = '--request-file'

/** One madangd process: its PID, start time, and the instance lock record it published. */
export const MadangdManagedStopInstanceSchema = z.object({
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  startedAtMs: z.number().finite().nonnegative().nullable(),
  /** Linux only, copied from the lock; older clients omit it and older slots drop it. */
  linuxStartTicks: z.string().regex(/^\d+$/).max(32).optional().catch(undefined),
  bootId: z.string().min(1).max(255).optional().catch(undefined),
  nonce: z.string().min(1).max(255),
  lockPath: z.string().min(1).max(4096)
})

// Older slots drop newer optional request fields rather than refuse the stop.
export const MadangdManagedStopRequestSchema = z.object({
  schemaVersion: z.literal(1),
  transactionId: z.uuid(),
  version: z.string().min(1).max(255),
  runtimeId: z.string().min(1).max(255),
  instance: MadangdManagedStopInstanceSchema,
  /** Best effort: also retire the terminal daemon if it is provably idle. Never blocks the stop. */
  retireIdleDaemon: z.literal(true).optional()
})

export type MadangdManagedStopInstance = z.infer<typeof MadangdManagedStopInstanceSchema>
export type MadangdManagedStopRequest = z.infer<typeof MadangdManagedStopRequestSchema>

/** Equality key for a request; omits the incarnation, which an older client recovering it drops. */
export function madangdManagedStopRequestKey(request: MadangdManagedStopRequest): string {
  const { instance, ...rest } = MadangdManagedStopRequestSchema.parse(request)
  const { linuxStartTicks: _ticks, bootId: _bootId, ...bound } = instance
  return JSON.stringify({ ...rest, instance: bound })
}
/** What a stopping madangd must match before a managed request may stop it. */
export type MadangdManagedStopContext = Omit<
  MadangdManagedStopRequest,
  'schemaVersion' | 'transactionId'
>

const STOP_VERDICTS = ['live', 'unverifiable', 'exited'] as const
const RETIREMENT_VERDICTS = ['retired', 'live', 'unverifiable'] as const

/** The execution host's verdict; `exited` only on proof, never on silence. */
export const MadangdManagedStopVerdictSchema = z.enum(STOP_VERDICTS)

/** `retired` only when the daemon accepted; a busy daemon stays up and keeps its terminals. */
export const MadangdDaemonRetirementVerdictSchema = z.enum(RETIREMENT_VERDICTS)

// Read by clients older than the slot that printed them: unknown fields and arms degrade.
const stopReplyRequestFields = MadangdManagedStopRequestSchema.shape

export const MadangdManagedStopCompletionSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('madangd_managed_stop_completion'),
  verdict: openEnum(STOP_VERDICTS, 'unverifiable'),
  receiptPersisted: z.boolean(),
  /** For a request that asked to retire the daemon, the outcome its receipt recorded. */
  retirement: openEnum(RETIREMENT_VERDICTS, 'unverifiable').optional()
})

/** What the stopping madangd observed about its daemon, written before it exits. */
export const MadangdDaemonRetirementRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('madangd_managed_stop_retirement'),
  request: MadangdManagedStopRequestSchema,
  retirement: MadangdDaemonRetirementVerdictSchema,
  liveSessions: z.number().int().nonnegative().nullable(),
  reason: z.string().max(4096).nullable()
})

export const MadangdCompletedStopReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('madangd_managed_stop_completed'),
  request: MadangdManagedStopRequestSchema,
  exitedAt: z.iso.datetime({ offset: true }),
  /** Present only when the request asked to retire the daemon. */
  retirement: MadangdDaemonRetirementVerdictSchema.optional()
})

export type MadangdManagedStopVerdict = z.infer<typeof MadangdManagedStopVerdictSchema>
export type MadangdManagedStopCompletion = z.infer<typeof MadangdManagedStopCompletionSchema>
export type MadangdCompletedStopReceipt = z.infer<typeof MadangdCompletedStopReceiptSchema>
export type MadangdDaemonRetirementVerdict = z.infer<typeof MadangdDaemonRetirementVerdictSchema>
export type MadangdDaemonRetirementRecord = z.infer<typeof MadangdDaemonRetirementRecordSchema>

export const MADANGD_CANCEL_MANAGED_STOP_FLAG = '--cancel-managed-stop'
/** Readiness `health.stopRequests`: this build consumes stop files and both commands above. */
export const MADANGD_STOP_REQUESTS_CAPABILITY = 1

/** Exclusive per-transaction creation ensures only madangd dispatch or client cancellation can win. */
export const MadangdManagedStopDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('madangd_managed_stop_decision'),
  request: MadangdManagedStopRequestSchema,
  decision: z.enum(['dispatched', 'canceled'])
})

/** `dispatched` means madangd already acted on the request; the caller must await its exit. */
export const MadangdManagedStopCancellationSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('madangd_managed_stop_cancellation'),
  // Unknown degrades to `dispatched`: the caller then awaits exit rather than assume a cancel.
  outcome: openEnum(['canceled', 'dispatched'], 'dispatched')
})

export type MadangdManagedStopDecision = z.infer<typeof MadangdManagedStopDecisionSchema>
export type MadangdManagedStopCancellation = z.infer<typeof MadangdManagedStopCancellationSchema>
