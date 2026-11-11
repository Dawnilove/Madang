import { useState } from 'react'
import { ChevronDown, ChevronRight, Quote, Reply, SquareTerminal, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  removeNativeChatContextBlock,
  useNativeChatContextBlocks,
  type NativeChatContextBlock
} from './native-chat-context-blocks'

/** First non-empty line of the card text without quote markers or fences. */
export function nativeChatContextPreview(
  text: string,
  // A line the card already shows as its label (a command's own `$ cmd` line).
  skip?: string
): { line: string; lineCount: number } {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.replace(/^>\s?/, ''))
  const body = lines.filter((line) => !/^`{3,}/.test(line))
  const line = body.find((l) => l.trim() !== '' && l.trim() !== skip?.trim())
  return { line: line?.trim() ?? '', lineCount: body.length }
}

const KIND_ICON = { reply: Reply, quote: Quote, command: SquareTerminal } as const

function kindLabel(kind: NativeChatContextBlock['kind']): string {
  if (kind === 'command') {
    return translate('components.native-chat.context.command', 'Command output')
  }
  return kind === 'reply'
    ? translate('components.native-chat.context.reply', 'Reply')
    : translate('components.native-chat.context.quote', 'Quote')
}

function ContextCard({
  block,
  scope
}: {
  block: NativeChatContextBlock
  scope: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const Icon = KIND_ICON[block.kind]
  const { line, lineCount } = nativeChatContextPreview(block.text, block.label)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <li className="min-w-0 rounded-md border border-border/70 bg-muted/40 text-xs">
      <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen(!open)}
        >
          <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium">{block.label || kindLabel(block.kind)}</span>
          <span className="min-w-0 truncate text-muted-foreground">{line}</span>
          {lineCount > 1 ? (
            <span className="shrink-0 text-muted-foreground">
              {translate('components.native-chat.context.lines', '{{count}} lines', {
                count: lineCount
              })}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={translate('components.native-chat.context.remove', 'Remove')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => removeNativeChatContextBlock(scope, block.id)}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {open ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-border/70 px-2 py-1.5 font-mono text-[11px]">
          {block.text.trimEnd()}
        </pre>
      ) : null}
    </li>
  )
}

/** Compact cards for attached context; the full text is sent, only the view is folded. */
export function NativeChatContextBlocks({ scope }: { scope: string }): React.JSX.Element | null {
  const blocks = useNativeChatContextBlocks(scope)
  if (blocks.length === 0) {
    return null
  }
  return (
    <ul
      className="mb-1.5 flex flex-col gap-1 px-1 pt-1"
      aria-label={translate('components.native-chat.context.listLabel', 'Attached context')}
    >
      {blocks.map((block) => (
        <ContextCard key={block.id} block={block} scope={scope} />
      ))}
    </ul>
  )
}
