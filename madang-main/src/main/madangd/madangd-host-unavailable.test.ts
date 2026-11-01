import { describe, expect, it } from 'vitest'
import {
  classifyMadangdHostUnavailable,
  madangdCandidateLaunchFailureCode
} from './madangd-host-unavailable'
import { MadangdWindowsLaunchRefusedError } from '../managed-server/install/madangd-remote-launch-windows'
import { MadangdWindowsCommandLineError } from '../managed-server/install/madangd-remote-windows-node'

describe('classifyMadangdHostUnavailable', () => {
  it('sends a Windows host that cannot launch madangd back to the relay', () => {
    const refused = new MadangdWindowsLaunchRefusedError('breakaway denied')
    const unsafe = new MadangdWindowsCommandLineError('C:\\Users\\%x%')
    expect(classifyMadangdHostUnavailable(refused)).toBe('unsupported_host')
    expect(classifyMadangdHostUnavailable(unsafe)).toBe('unsupported_host')
    expect(classifyMadangdHostUnavailable({ code: refused.code })).toBe('unsupported_host')
    expect(classifyMadangdHostUnavailable({ code: unsafe.code })).toBe('unsupported_host')
  })

  it('keeps an ordinary launch failure retryable', () => {
    expect(madangdCandidateLaunchFailureCode(new Error('spawn failed'))).toBe(
      'madangd_candidate_launch_failed'
    )
    expect(
      classifyMadangdHostUnavailable({
        code: madangdCandidateLaunchFailureCode(new Error('spawn failed'))
      })
    ).toBeNull()
    expect(madangdCandidateLaunchFailureCode(new MadangdWindowsLaunchRefusedError('x'))).toBe(
      'madangd_windows_launch_refused'
    )
  })
})
