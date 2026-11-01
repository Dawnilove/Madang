import { describe, expect, it } from 'vitest'
import {
  adoptedTranscriptSourceObserver,
  claudeDesktopCwdMatches
} from './adopted-transcript-source'

const source = { providerSessionId: 'cli-a', workspaceCwd: 'C:\\Users\\me\\work' }
const reader = (cwds: Record<string, string>) => async () => ({ archived: [], known: [], cwds })

describe('claudeDesktopCwdMatches', () => {
  it('accepts a session whose desktop folder is the workspace', async () => {
    expect(await claudeDesktopCwdMatches(source, reader({ 'cli-a': 'C:/Users/me/work' }))).toBe(
      true
    )
  })

  it('rejects a different folder, an unknown session, and a missing folder map', async () => {
    expect(await claudeDesktopCwdMatches(source, reader({ 'cli-a': 'C:\\Users\\me\\other' }))).toBe(
      false
    )
    expect(await claudeDesktopCwdMatches(source, reader({ 'cli-b': 'C:\\Users\\me\\work' }))).toBe(
      false
    )
    expect(await claudeDesktopCwdMatches(source, async () => ({ archived: [], known: [] }))).toBe(
      false
    )
  })
})

describe('adoptedTranscriptSourceObserver folder check', () => {
  it('keeps the desktop folder exception to Claude: another agent with another folder is rejected', async () => {
    const observer = adoptedTranscriptSourceObserver({
      agent: 'omp',
      filePath: 'C:/sessions/cli-a.jsonl',
      source,
      maxSourceBytes: 1024
    })
    observer.observe(JSON.stringify({ type: 'session', id: 'cli-a', cwd: 'C:\\Users\\me\\old' }))
    await expect(observer.validate()).rejects.toThrow('another directory')
  })
})
