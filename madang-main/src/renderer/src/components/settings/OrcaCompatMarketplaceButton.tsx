import { useState } from 'react'
import { Loader2, Store } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { ORCA_COMPAT_MARKETPLACE_GIT_SOURCE } from '../../../../shared/plugins/orca-compat'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'

type OrcaCompatMarketplaceButtonProps = {
  variant?: 'ghost' | 'outline'
  size?: 'xs' | 'sm'
  onAdded: () => Promise<void>
}

/** Adds Orca's plugin index as a third-party marketplace after the user confirms. */
export function OrcaCompatMarketplaceButton({
  variant = 'ghost',
  size = 'xs',
  onAdded
}: OrcaCompatMarketplaceButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.plugins.addMarketplace(ORCA_COMPAT_MARKETPLACE_GIT_SOURCE)
      setOpen(false)
      await onAdded()
    } catch (cause) {
      console.warn('[plugins] could not add the Orca-compatible marketplace:', cause)
      setError(
        translate(
          'madang.orcaCompat.failed',
          'Could not add the Orca-compatible plugins. Check your connection and try again.'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Store />
        {translate('madang.orcaCompat.button', 'Add Orca-compatible plugins')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {translate('madang.orcaCompat.title', 'Add Orca-compatible plugins')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'madang.orcaCompat.warning',
                'These are third-party plugins made for Orca. Madang has not verified them.'
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="break-all text-xs text-muted-foreground">
            {ORCA_COMPAT_MARKETPLACE_GIT_SOURCE.url}
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {translate('madang.orcaCompat.cancel', 'Cancel')}
            </Button>
            <Button disabled={busy} onClick={() => void add()}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {translate('madang.orcaCompat.confirm', 'Add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
