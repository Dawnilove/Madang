// Translate managed SSH server status through the catalog.
import type {
  SshConnectionState,
  SshManagedServerLinkedProject,
  SshTarget
} from '../../../shared/ssh-types'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { launchSessionEndedLine } from './ssh-host-launch-session-copy'
import { bridgedTerminalsLine } from './ssh-host-bridged-terminals-copy'
import { managedUpdateLine, withDetail } from './ssh-host-server-update-copy'
import { blockedNodeDownload, nodeDownloadBlockedText } from './ssh-host-node-download-copy'
import { settingUpLabel, sshHostServerReassurance } from './ssh-host-server-setup-copy'
import { hostFixableUnavailableText } from './ssh-host-fixable-unavailable-copy'

export type SshHostServerStatusLine = {
  text: string
  tone: 'muted' | 'warning' | 'destructive'
  /** Main's untranslated cause, with the host's madangd.log tail when there is one; shown on request. */
  detail?: string
  /** A muted second line, e.g. what moving onto the host does and doesn't touch. */
  hint?: string
}

export function sshHostServerStatusLine(
  target: Pick<SshTarget, 'label' | 'madangdFence' | 'managedServerUnavailable'>,
  state: Pick<SshConnectionState, 'managedServer'> | undefined
): SshHostServerStatusLine | null {
  const status = state?.managedServer
  if (target.madangdFence?.sourceChangedAt) {
    return sourceChangedLine()
  }
  if (status?.kind === 'managed' && status.serving) {
    return {
      tone: 'warning',
      text: translate(
        'auto.components.settings.sshHostServer.notServing',
        'Madang couldn’t confirm that its server on {{host}} is answering.',
        { host: target.label }
      ),
      detail: status.serving.detail
    }
  }
  if (status?.kind === 'managed' && status.launchSessionEnded) {
    return launchSessionEndedLine()
  }
  if (status?.kind === 'managed' && status.update) {
    return managedUpdateLine(status.update)
  }
  if (status?.kind === 'managed' && status.linked?.length) {
    return linkedProjectsLine(status.linked)
  }
  // A healthy managed server is the default; the card stays quiet unless something needs attention.
  if (status?.kind === 'managed' || (!status && target.madangdFence)) {
    return null
  }
  if (status?.kind === 'setting-up') {
    return {
      tone: 'muted',
      text: settingUpLabel(status.phase, target.label),
      // Why only these phases: `starting` and `connecting` run on every reconnect, when nothing moves.
      ...(status.phase === 'deploying' || status.phase === 'converting'
        ? { hint: sshHostServerReassurance(target.label) }
        : {})
    }
  }
  if (status?.kind === 'relay') {
    // An unverifiable bridged terminal keeps the unverifiable line: nothing proves it still answers.
    return status.bridged && status.reason === 'relay_terminals_live'
      ? bridgedTerminalsLine(status.detail)
      : unservedLine(status)
  }
  if (target.managedServerUnavailable) {
    return unavailableLine(target.managedServerUnavailable.reason)
  }
  return null
}

export function sshConnectFailureText(
  state: Pick<SshConnectionState, 'managedServer'> | undefined,
  fallback: string
): string {
  const status = state?.managedServer
  // Uncapped because panes/toasts lack Details and refusal recovery guidance comes last.
  return status?.kind === 'relay' ? unservedLine(status, Number.POSITIVE_INFINITY).text : fallback
}

export function sshTargetConnectFailureText(
  targetId: string,
  error: unknown,
  fallback: string
): string {
  return sshConnectFailureText(
    useAppStore.getState().sshConnectionStates.get(targetId),
    error instanceof Error ? error.message : fallback
  )
}

// Mirror main's MADANGD_TUNNEL_UNAVAILABLE_REASON.
const TUNNEL_UNAVAILABLE = 'ssh_tunnel_unavailable'

function sourceChangedLine(): SshHostServerStatusLine {
  return {
    tone: 'warning',
    text: translate(
      'auto.components.settings.sshHostServer.sourceChanged',
      'This computer has projects or folders for this host that its Madang server doesn’t have yet, often added by an older version of Madang. Move them to this host’s Madang server, or keep the server’s version, to connect again.'
    )
  }
}

/** `reason` is main's MadangdHostUnavailableReason; an unknown one is shown only as a detail. */
function unavailableLine(reason: string | undefined): SshHostServerStatusLine {
  if (reason === TUNNEL_UNAVAILABLE) {
    return tunnelUnavailableLine()
  }
  const fixable = reason ? hostFixableUnavailableText(reason) : null
  if (fixable) {
    return { tone: 'destructive', text: fixable }
  }
  const cause = reason ? unavailableCause(reason) : null
  if (cause) {
    return {
      tone: 'destructive',
      text: translate(
        'auto.components.settings.sshHostServer.unsupported',
        'This host isn’t supported by this version of Madang ({{reason}}). To keep using it, install an older version of Madang.',
        { reason: cause }
      )
    }
  }
  return {
    tone: 'destructive',
    text: translate(
      'auto.components.settings.sshHostServer.unsupportedUnknown',
      'This host isn’t supported by this version of Madang. To keep using it, install an older version of Madang.'
    ),
    ...(reason ? { detail: reason } : {})
  }
}

function unavailableCause(reason: string): string | null {
  switch (reason) {
    case 'unsupported_host':
      return translate(
        'auto.components.settings.sshHostServer.cause.unsupportedHost',
        'Madang has no server build for this system'
      )
    case 'artifacts_unavailable':
      return translate(
        'auto.components.settings.sshHostServer.cause.artifactsUnavailable',
        'this Madang build doesn’t include the server'
      )
    case 'libc_unidentified':
      return translate(
        'auto.components.settings.sshHostServer.cause.libcUnidentified',
        'Madang couldn’t identify the host’s system libraries'
      )
    case 'runtime_self_test':
      return translate(
        'auto.components.settings.sshHostServer.cause.runtimeSelfTest',
        'the server’s runtime failed its self-test'
      )
    case 'security_software':
      return translate(
        'auto.components.settings.sshHostServer.cause.securitySoftware',
        'security software changed the server’s runtime'
      )
    case 'native_preflight':
      return translate(
        'auto.components.settings.sshHostServer.cause.nativePreflight',
        'the host is missing system libraries the server needs'
      )
    default:
      return null
  }
}

function tunnelUnavailableLine(): SshHostServerStatusLine {
  return {
    tone: 'destructive',
    text: translate(
      'auto.components.settings.sshHostServer.tunnelUnsupported',
      'This host isn’t supported by this version of Madang: its SSH server doesn’t allow port forwarding, and Madang couldn’t reach its server through the SSH session either. To keep using it, install an older version of Madang.'
    )
  }
}

function retryLine(): SshHostServerStatusLine {
  return {
    tone: 'warning',
    text: translate(
      'auto.components.settings.sshHostServer.setupRetry',
      'Madang couldn’t start its server on this host. Try connecting again.'
    )
  }
}

function contactLostLine(): SshHostServerStatusLine {
  return {
    tone: 'warning',
    text: translate(
      'auto.components.settings.sshHostServer.setupContactLost',
      'Madang lost contact with this host while setting up its server. Nothing on the host was stopped. Connect again to continue.'
    )
  }
}

function heldMoveLine(): SshHostServerStatusLine {
  return {
    tone: 'warning',
    text: translate(
      'auto.components.settings.sshHostServer.moveHeld',
      'Madang paused moving this host’s projects to its Madang server because it couldn’t confirm the server’s copy. Nothing is lost: the host keeps its projects and stays locked until the move finishes. Connect again to resume. If the server can’t come back, stop or forget it in Settings > Madang on your SSH hosts.'
    )
  }
}

/** Projects the server already had: this desktop's own tabs and automations for them stayed behind. */
function linkedProjectsLine(
  linked: readonly SshManagedServerLinkedProject[]
): SshHostServerStatusLine {
  const paths = linked.map((project) => project.path).join(', ')
  const count = linked.reduce((total, project) => total + project.automations, 0)
  return {
    tone: 'warning',
    text:
      count > 0
        ? translate(
            'auto.components.settings.sshHostServer.linkedProjects',
            'This host’s Madang server already had {{paths}}, so this desktop now uses the server’s copy. This desktop’s tabs and {{count}} automations there were not moved, and worktrees it created there show as external worktrees.',
            { paths, count }
          )
        : translate(
            'auto.components.settings.sshHostServer.linkedProjectsNoAutomations',
            'This host’s Madang server already had {{paths}}, so this desktop now uses the server’s copy. This desktop’s tabs there were not moved, and worktrees it created there show as external worktrees.',
            { paths }
          )
  }
}

// Why a cap: a refusal can list every blocking tab; the whole text stays behind "Details".
const REFUSAL_INLINE_CHARS = 280

/** Names what refuses the move; main writes that reason, with the way out, in English. */
function refusedLine(detail: string | undefined, inlineChars: number): SshHostServerStatusLine {
  const reason = detail?.trim()
  if (!reason) {
    return {
      tone: 'destructive',
      text: translate(
        'auto.components.settings.sshHostServer.refusedBlocked',
        'Madang isn’t set up on this host yet: something on the host stops the move.'
      )
    }
  }
  const inline = reason.length > inlineChars ? `${reason.slice(0, inlineChars).trimEnd()}…` : reason
  return {
    tone: 'destructive',
    text: translate(
      'auto.components.settings.sshHostServer.refusedBlockedReason',
      'Madang isn’t set up on this host yet. {{reason}}',
      { reason: inline }
    ),
    detail: reason
  }
}

function unservedLine(
  status: Extract<NonNullable<SshConnectionState['managedServer']>, { kind: 'relay' }>,
  refusalChars = REFUSAL_INLINE_CHARS
): SshHostServerStatusLine {
  switch (status.reason) {
    case 'relay_terminals_live':
      return {
        tone: 'warning',
        // Why: an absent count is unreported, never zero open terminals.
        text: status.terminals
          ? translate(
              'auto.components.settings.sshHostServer.olderTerminals',
              '{{count}} terminals started by an older version of Madang are still running on this host, and they don’t stop on their own. Close them in that version of Madang or end them on the host, then reconnect.',
              { count: status.terminals }
            )
          : translate(
              'auto.components.settings.sshHostServer.olderTerminalsUncounted',
              'Terminals started by an older version of Madang are still running on this host, and they don’t stop on their own. Close them in that version of Madang or end them on the host, then reconnect.'
            )
      }
    case 'relay_terminals_unverifiable':
      return {
        tone: 'warning',
        text: translate(
          'auto.components.settings.sshHostServer.olderTerminalsUnverifiable',
          'Madang couldn’t confirm that terminals started by an older version of Madang have exited. Reconnect to try again.'
        )
      }
    case 'madangd_unavailable':
      return unavailableLine(status.detail)
    case 'source_changed':
      return sourceChangedLine()
    case 'refused':
      return refusedLine(status.detail, refusalChars)
    case 'deferred':
    case 'failed': {
      const blocked = blockedNodeDownload(status)
      return {
        ...(blocked
          ? { tone: 'destructive' as const, text: nodeDownloadBlockedText(blocked) }
          : status.held
            ? heldMoveLine()
            : status.contactLost
              ? contactLostLine()
              : retryLine()),
        ...withDetail(status.detail)
      }
    }
  }
}
