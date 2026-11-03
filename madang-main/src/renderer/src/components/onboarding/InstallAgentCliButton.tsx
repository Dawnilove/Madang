import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isInstallableAgentCli } from '../../../../shared/agent-cli-install'
import { isCompanyEdition } from '../../../../shared/madang-edition'

/** The install runs in a visible PowerShell window (Windows only); the company edition never offers it. */
export function canOfferInstall(agent: string): boolean {
  return (
    !isCompanyEdition() &&
    isInstallableAgentCli(agent) &&
    typeof navigator !== 'undefined' &&
    /Windows/i.test(navigator.userAgent)
  )
}

export function InstallAgentCliButton({ agent }: { agent: string }): React.JSX.Element {
  const [running, setRunning] = useState(false)
  const install = async (): Promise<void> => {
    setRunning(true)
    try {
      const result = await window.api.shell.installAgentCli(agent)
      if (result.status === 'failed') {
        toast.error(
          translate('madang.agentInstall.failed', 'Could not start the installer: {{error}}', {
            error: result.error
          })
        )
        return
      }
      if (result.status === 'finished') {
        // The new CLI is on PATH only for processes started after the install, so look again now.
        await useAppStore.getState().refreshDetectedAgents()
        toast(
          translate(
            'madang.agentInstall.finished',
            'The install window closed. If the agent is still not detected, restart Madang.'
          )
        )
      }
    } finally {
      setRunning(false)
    }
  }
  return (
    <Button
      type="button"
      size="xs"
      className="shrink-0"
      disabled={running}
      onClick={() => void install()}
    >
      {running
        ? translate('madang.agentInstall.running', 'Installing… (see the PowerShell window)')
        : translate('madang.agentInstall.button', 'Install')}
    </Button>
  )
}
