// Mirror main's host-fixable MadangdHostUnavailableReason values; each names what to change on the host.
import { translate } from '@/i18n/i18n'

export function hostFixableUnavailableText(reason: string): string | null {
  switch (reason) {
    case 'runtime_noexec':
      return translate(
        'auto.components.settings.sshHostServer.runtimeNoexec',
        'This host doesn’t allow running programs from ~/.madang-remote, so Madang can’t start its server there. This usually means the home folder is mounted with noexec. Ask the host’s administrator to allow running programs there, then connect again.'
      )
    case 'windows_build_unsupported':
      return translate(
        'auto.components.settings.sshHostServer.windowsBuildUnsupported',
        'This host runs a version of Windows older than Windows 10 and Windows Server 2016, so it can’t run Madang’s server. Use a host with a newer version of Windows, or a Linux or macOS host.'
      )
    case 'windows_no_extractor':
      return translate(
        'auto.components.settings.sshHostServer.windowsNoExtractor',
        'This Windows host has neither tar.exe nor PowerShell’s Expand-Archive, so Madang can’t unpack its server there. Install Windows PowerShell 5.1 on the host, then connect again.'
      )
    default:
      return null
  }
}
