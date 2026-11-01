import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { stripClientEnvironmentFooter } from '../../shared/client-environment-info'
import { MADANG_ISSUES_URL } from '../../shared/madang-features'
import type { FeedbackSubmitResult } from '../../shared/feedback-submit-contract'
import type { FeedbackSubmitBody } from '../ipc/feedback-request'

// Why: GitHub rejects very long new-issue URLs; the full text stays in the saved report.
const ISSUE_BODY_MAX_CHARS = 6000
const ISSUE_TITLE_MAX_CHARS = 72

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

function reportFolderName(body: FeedbackSubmitBody, now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${body.submissionType}`
}

function environmentLines(body: FeedbackSubmitBody): string[] {
  return [`- Madang: ${body.appVersion}`, `- OS: ${body.platform} ${body.osRelease} (${body.arch})`]
}

// Why: the dialog prefills its own environment footer; drop it so the report carries one copy.
function userText(body: FeedbackSubmitBody): string {
  return stripClientEnvironmentFooter(body.feedback).trim()
}

export function buildLocalReportMarkdown(body: FeedbackSubmitBody): string {
  return [userText(body), '', '---', ...environmentLines(body), ''].join('\n')
}

function issueTitle(body: FeedbackSubmitBody): string {
  const prefix = body.submissionType === 'crash' ? '[충돌 보고]' : '[피드백]'
  const firstLine = userText(body).split(/\r?\n/, 1)[0]?.trim() ?? ''
  const summary =
    body.submissionType === 'crash' || !firstLine ? `Madang ${body.appVersion}` : firstLine
  const title = `${prefix} ${summary}`
  return title.length > ISSUE_TITLE_MAX_CHARS
    ? `${title.slice(0, ISSUE_TITLE_MAX_CHARS - 1)}…`
    : title
}

function issueBody(body: FeedbackSubmitBody, hasAttachments: boolean): string {
  const text = userText(body)
  const clipped =
    text.length > ISSUE_BODY_MAX_CHARS
      ? `${text.slice(0, ISSUE_BODY_MAX_CHARS)}\n\n(내용이 길어 잘랐습니다. 전체 내용은 저장된 보고서 파일에 있습니다.)`
      : text
  // Why: never put local paths or diagnostic logs in the URL; the user attaches files from the opened folder.
  const attachmentNote = hasAttachments
    ? [
        '',
        '> 이미지·진단 로그는 이 PC의 보고서 폴더에 저장했습니다. 필요하면 이 이슈에 끌어다 놓으세요.'
      ]
    : []
  return [clipped, '', '---', ...environmentLines(body), ...attachmentNote].join('\n')
}

export function buildNewIssueUrl(body: FeedbackSubmitBody, hasAttachments: boolean): string {
  const params = new URLSearchParams({
    title: issueTitle(body),
    body: issueBody(body, hasAttachments)
  })
  return `${MADANG_ISSUES_URL}/new?${params.toString()}`
}

/**
 * Madang has no feedback server: save the report on this PC and open a prefilled
 * GitHub issue so the user reviews and sends it themselves.
 */
export async function saveLocalFeedbackReport(
  body: FeedbackSubmitBody,
  now = new Date()
): Promise<FeedbackSubmitResult> {
  try {
    const folder = join(app.getPath('userData'), 'feedback-reports', reportFolderName(body, now))
    await mkdir(folder, { recursive: true })
    const reportPath = join(folder, 'report.md')
    await writeFile(reportPath, buildLocalReportMarkdown(body), 'utf8')

    const images = body.images ?? []
    for (const [index, image] of images.entries()) {
      const extension = IMAGE_EXTENSIONS[image.contentType] ?? 'bin'
      await writeFile(join(folder, `image-${index + 1}.${extension}`), image.data)
    }
    if (body.diagnosticBundle) {
      await writeFile(join(folder, 'diagnostic-logs.txt'), body.diagnosticBundle.content, 'utf8')
    }

    const hasAttachments = images.length > 0 || Boolean(body.diagnosticBundle)
    await shell.openExternal(buildNewIssueUrl(body, hasAttachments))
    if (hasAttachments) {
      shell.showItemInFolder(reportPath)
    }
    return { ok: true, savedLocally: true }
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
