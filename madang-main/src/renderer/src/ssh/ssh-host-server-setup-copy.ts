import type { SSH_MANAGED_SERVER_PHASES } from '../../../shared/ssh-types'
import { translate } from '@/i18n/i18n'

/** Users read "server" as someone else's machine; this says where Orca runs and what moves. */
export function sshHostServerReassurance(host: string): string {
  return translate(
    'auto.components.settings.sshHostServer.reassurance',
    'Runs on {{host}}, reached over your own SSH connection. Your code and files stay where they are. Only Madang’s list of projects, tabs and terminals moves to {{host}}.',
    { host }
  )
}

export function settingUpLabel(
  phase: (typeof SSH_MANAGED_SERVER_PHASES)[number],
  host: string
): string {
  switch (phase) {
    case 'deploying':
      return translate(
        'auto.components.settings.sshHostServer.deploying',
        'Setting up Madang on {{host}}…',
        { host }
      )
    case 'converting':
      return translate(
        'auto.components.settings.sshHostServer.converting',
        'Moving to Madang on {{host}}…',
        { host }
      )
    case 'connecting':
      return translate(
        'auto.components.settings.sshHostServer.connecting',
        'Connecting to Madang on {{host}}…',
        { host }
      )
    case 'updating':
      return translate(
        'auto.components.settings.sshHostServer.updating',
        'Updating Madang on {{host}}…',
        { host }
      )
    case 'starting':
      return translate(
        'auto.components.settings.sshHostServer.starting',
        'Starting Madang on {{host}}…',
        { host }
      )
  }
}
