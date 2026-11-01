import { describe, expect, it } from 'vitest'
import {
  getTuiAgentDetectionProbeCommands,
  KNOWN_TUI_AGENT_DETECTION_COMMANDS,
  resolveDetectedTuiAgentIds
} from '../../shared/tui-agent-detection-commands'

describe('tui agent detection commands', () => {
  it.each(['darwin', 'linux', 'win32', 'wsl'] as const)(
    'detects modern and legacy Qoder once on %s',
    (runtime) => {
      const commands = KNOWN_TUI_AGENT_DETECTION_COMMANDS.filter(
        (command) => command.id === 'qoder'
      )
      for (const found of [
        new Set(['qoder']),
        new Set(['qodercli']),
        new Set(['qoder', 'qodercli'])
      ]) {
        expect(resolveDetectedTuiAgentIds(commands, found, runtime)).toEqual(['qoder'])
      }
      expect(resolveDetectedTuiAgentIds(commands, new Set(['qoder-unrelated']), runtime)).toEqual(
        []
      )
    }
  )
  it('requires Claude before reporting Claude Agent Teams', () => {
    const commands = KNOWN_TUI_AGENT_DETECTION_COMMANDS.filter(
      (command) => command.id === 'claude-agent-teams'
    )

    expect(commands).toEqual([
      {
        id: 'claude-agent-teams',
        cmd: 'madang',
        requiredCommands: ['claude'],
        unsupportedRuntimes: ['win32', 'wsl']
      },
      {
        id: 'claude-agent-teams',
        cmd: 'madang-dev',
        requiredCommands: ['claude'],
        unsupportedRuntimes: ['win32', 'wsl']
      },
      {
        id: 'claude-agent-teams',
        cmd: 'madang-ide',
        requiredCommands: ['claude'],
        unsupportedRuntimes: ['win32', 'wsl']
      }
    ])
    expect(getTuiAgentDetectionProbeCommands(commands, 'linux')).toEqual([
      'madang',
      'claude',
      'madang-dev',
      'madang-ide'
    ])
    expect(resolveDetectedTuiAgentIds(commands, new Set(['madang']), 'linux')).toEqual([])
    expect(resolveDetectedTuiAgentIds(commands, new Set(['madang', 'claude']), 'linux')).toEqual([
      'claude-agent-teams'
    ])
    expect(getTuiAgentDetectionProbeCommands(commands, 'win32')).toEqual([])
    expect(resolveDetectedTuiAgentIds(commands, new Set(['madang', 'claude']), 'win32')).toEqual([])
    expect(getTuiAgentDetectionProbeCommands(commands, 'wsl')).toEqual([])
    expect(resolveDetectedTuiAgentIds(commands, new Set(['madang-ide', 'claude']), 'wsl')).toEqual(
      []
    )
  })
})
