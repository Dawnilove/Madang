import os from 'node:os'
import { app, ipcMain } from 'electron'
import { validateFeedbackImages } from './feedback-image-attachments'
import type {
  FeedbackImageAttachment,
  FeedbackRequestFailure,
  FeedbackSubmitArgs,
  FeedbackSubmitResult
} from '../../shared/feedback-submit-contract'
import type {
  FeedbackDiagnosticBundleAttachment,
  FeedbackSubmissionType,
  FeedbackSubmitBody
} from './feedback-request'
import { saveLocalFeedbackReport } from '../madang/local-feedback-report'

export type {
  FeedbackDiagnosticBundleAttachment,
  FeedbackImageAttachment,
  FeedbackRequestFailure,
  FeedbackSubmissionType,
  FeedbackSubmitArgs,
  FeedbackSubmitResult
}

type InternalFeedbackSubmitArgs = FeedbackSubmitArgs & {
  submissionType?: FeedbackSubmissionType
  diagnosticBundle?: FeedbackDiagnosticBundleAttachment
  feedbackWithoutDiagnosticBundle?: string
}

// Enrich trusted build/OS identity in main rather than accepting renderer claims.
function buildSubmitBody(args: InternalFeedbackSubmitArgs): FeedbackSubmitBody {
  const identity = args.submitAnonymously
    ? { githubLogin: null, githubEmail: null }
    : { githubLogin: args.githubLogin, githubEmail: args.githubEmail }

  // Allow-list anonymous payloads so stale or future identity fields cannot leak into the saved report.
  return {
    feedback: args.feedback,
    submissionType: args.submissionType ?? 'feedback',
    ...identity,
    appVersion: app.getVersion(),
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    ...(args.submissionType === 'crash' && args.diagnosticBundle
      ? { diagnosticBundle: args.diagnosticBundle }
      : {}),
    // Crash reports carry diagnostic bundles; only feedback keeps images.
    ...(args.submissionType !== 'crash' && args.images?.length ? { images: args.images } : {})
  }
}

// Madang has no feedback server: every report is saved on this computer.
export async function submitFeedback(
  args: InternalFeedbackSubmitArgs
): Promise<FeedbackSubmitResult> {
  // Ignore discarded crash-lane images instead of rejecting over unused attachments.
  if (args.submissionType !== 'crash' && args.images !== undefined) {
    const imageError = validateFeedbackImages(args.images)
    if (imageError) {
      return { ok: false, status: null, error: imageError }
    }
  }
  return saveLocalFeedbackReport(buildSubmitBody(args))
}

export function registerFeedbackHandlers(): void {
  ipcMain.removeHandler('feedback:submit')
  ipcMain.handle('feedback:submit', (_event, args: FeedbackSubmitArgs) => {
    // Validate before typed-array normalization can expand hostile renderer input.
    if (args.images !== undefined) {
      const imageError = validateFeedbackImages(args.images)
      if (imageError) {
        return { ok: false, status: null, error: imageError }
      }
    }
    // Force the public feedback lane at IPC; crash submission is main-only.
    return submitFeedback({
      ...args,
      submissionType: 'feedback'
    })
  })
}
