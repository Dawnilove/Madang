import { translate } from '@/i18n/i18n'

/** Stored default titles stay "Terminal N" (ordinal and agent-title logic match them); only the label shown is localized. */
export function localizeDefaultTerminalTitle(title: string): string {
  const match = /^Terminal (\d+)$/.exec(title)
  return match
    ? translate('madang.terminal.defaultTitle', 'Terminal {{value0}}', { value0: match[1] })
    : title
}
