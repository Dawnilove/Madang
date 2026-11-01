import { describe, expect, it } from 'vitest'
import {
  approvalToolName,
  localizeApprovalOptionLabel,
  localizeApprovalTitle,
  summarizeApprovalRequest
} from './approval-copy-localization'

describe('approval-copy-localization', () => {
  it('reads the tool name from a provider approval title', () => {
    expect(approvalToolName('Allow WebSearch?')).toBe('WebSearch')
    expect(approvalToolName('Review proposed plan')).toBeNull()
  })

  it('keeps unknown titles, options and tools as the provider sent them', () => {
    expect(localizeApprovalTitle('Allow mcp__x__y?')).toContain('mcp__x__y')
    expect(localizeApprovalTitle('Something else')).toBe('Something else')
    expect(localizeApprovalOptionLabel('Maybe later')).toBe('Maybe later')
  })

  it('does not resolve inherited object keys as tool names', () => {
    expect(summarizeApprovalRequest('Allow constructor?', '{"query":"x"}')).toBeNull()
  })

  it('summarizes what each tool will do from its input', () => {
    const search = summarizeApprovalRequest(
      'Allow WebSearch?',
      JSON.stringify({ query: 'drone law', mode: 'standard' })
    )
    expect(search?.value).toBe('drone law')
    expect(
      summarizeApprovalRequest('Allow Bash?', JSON.stringify({ command: 'rm -rf build' }))?.value
    ).toBe('rm -rf build')
    expect(
      summarizeApprovalRequest('Allow Read?', JSON.stringify({ file_path: 'C:\\a.txt' }))?.value
    ).toBe('C:\\a.txt')
  })

  it('returns no summary for cut-off, non-JSON or empty input', () => {
    expect(summarizeApprovalRequest('Allow WebSearch?', '{"query": "abc')).toBeNull()
    expect(summarizeApprovalRequest('Allow WebSearch?', 'plain text')).toBeNull()
    expect(summarizeApprovalRequest('Allow WebSearch?', undefined)).toBeNull()
    expect(summarizeApprovalRequest('Allow WebSearch?', '{}')).toBeNull()
  })

  it('clips a long value to a readable length', () => {
    const summary = summarizeApprovalRequest(
      'Allow Bash?',
      JSON.stringify({ command: 'x'.repeat(1000) })
    )
    expect(summary?.value.length).toBe(301)
    expect(summary?.value.endsWith('…')).toBe(true)
  })
})
