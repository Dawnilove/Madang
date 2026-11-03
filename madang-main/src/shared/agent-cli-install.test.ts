import { describe, expect, it } from 'vitest'
import { AGENT_CLI_INSTALL_COMMANDS, isInstallableAgentCli } from './agent-cli-install'

// The commands run on a user's PC, so the table itself is checked: each must be one plain line from a known shape.
const ALLOWED_START = /^(irm |iex \(irm |iwr -useb |npm (i|install) -g |winget install )/

describe('AGENT_CLI_INSTALL_COMMANDS', () => {
  it.each(Object.entries(AGENT_CLI_INSTALL_COMMANDS))(
    '%s is one plain install line',
    (_agent, command) => {
      expect(command).toMatch(ALLOWED_START)
      expect(command).not.toMatch(/[\r\n]/)
      expect(command).not.toMatch(/sudo|&&|;|`|\$\(/)
      if (command.startsWith('irm') || command.startsWith('iwr') || command.startsWith('iex')) {
        expect(command).toMatch(/https:\/\/[a-z0-9.-]+\//)
        expect(command).not.toMatch(/http:\/\//)
      }
    }
  )

  it('recognises only listed agents', () => {
    expect(isInstallableAgentCli('claude')).toBe(true)
    expect(isInstallableAgentCli('gemini')).toBe(true)
    expect(isInstallableAgentCli('zcode')).toBe(false)
    expect(isInstallableAgentCli('__proto__')).toBe(false)
    expect(isInstallableAgentCli(undefined)).toBe(false)
  })
})
