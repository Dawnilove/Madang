import type React from 'react'
import { CommentMarkdownAsync } from '@/components/sidebar/comment-markdown-lazy'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { ReleaseNotes } from '../../../../shared/whats-new'

function openLinkInDefaultBrowser(event: React.MouseEvent<HTMLElement>, href?: string): void {
  event.preventDefault()
  if (href && /^https?:\/\//i.test(href)) {
    void window.api.shell.openUrl(href)
  }
}

export function WhatsNewDialog({
  version,
  notes,
  onClose
}: {
  version: string
  notes: ReleaseNotes
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate('madang.whatsNew.title', "What's new")}</DialogTitle>
          <DialogDescription>
            {translate('madang.whatsNew.version', 'Version {{version}}', { version })}
          </DialogDescription>
        </DialogHeader>
        {/* compact 형식을 쓴다: 원격 이미지는 불러오지 않고 링크 글자로 바뀌며, HTML은 정제된다. */}
        <CommentMarkdownAsync
          content={notes.body}
          onLinkClick={openLinkInDefaultBrowser}
          className="max-h-[50vh] scrollbar-sleek overflow-y-auto text-sm leading-relaxed"
        />
        <DialogFooter>
          <Button onClick={onClose}>{translate('madang.whatsNew.close', 'Close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
