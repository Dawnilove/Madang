import type { FeedbackImageAttachment } from '../../shared/feedback-submit-contract'

export type FeedbackSubmissionType = 'feedback' | 'crash'

export type FeedbackDiagnosticBundleAttachment = {
  bundleSubmissionId: string
  content: string
  bytes: number
  spanCount: number
}

export type FeedbackSubmitBody = {
  feedback: string
  submissionType: FeedbackSubmissionType
  githubLogin: string | null
  githubEmail: string | null
  appVersion: string
  platform: NodeJS.Platform
  osRelease: string
  arch: string
  diagnosticBundle?: FeedbackDiagnosticBundleAttachment
  images?: FeedbackImageAttachment[]
}
