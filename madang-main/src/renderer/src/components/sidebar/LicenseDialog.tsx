import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import licenseText from '../../../../../LICENSE?raw'

/** Open-source notice: MIT requires the Orca copyright and permission text to ship with every copy. */
export function LicenseDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate('madang.licenses.title', 'Open source licenses')}</DialogTitle>
          <DialogDescription>
            {translate(
              'madang.licenses.basedOn',
              'Madang is built on the open-source Orca project (MIT License).'
            )}
          </DialogDescription>
        </DialogHeader>
        <pre
          data-testid="license-text"
          className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-xs"
        >
          {licenseText}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
