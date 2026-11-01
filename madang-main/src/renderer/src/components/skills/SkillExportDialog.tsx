import { useMemo, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { DiscoveredSkill } from '../../../../shared/skills'
import type { SkillExportOutcome } from '../../../../shared/skill-share-import-contract'
import { derivedBundleName } from './skill-bundle-name'
import { isSkillShareEligible } from './skill-share-selection'

type ExportError = Extract<SkillExportOutcome, { status: 'error' }>['code']

function exportErrorText(code: ExportError): string {
  if (code === 'duplicate-name') {
    return translate(
      'madang.skillShare.export.duplicateName',
      'Two selected skills share a name. Select only one of them.'
    )
  }
  if (code === 'too-large') {
    return translate(
      'madang.skillShare.export.tooLarge',
      'The bundle would be larger than 40 MB. Select fewer skills.'
    )
  }
  return translate('madang.skillShare.export.failed', 'Could not save the bundle.')
}

/** Saves chosen local skills as a .tar.gz bundle that another Madang can import. */
export function SkillExportDialog({
  open,
  onOpenChange,
  skills,
  local
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  skills: readonly DiscoveredSkill[]
  local: boolean
}): React.JSX.Element {
  const eligible = useMemo(
    () => skills.filter((skill) => isSkillShareEligible(skill, local)),
    [local, skills]
  )
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const toggle = (id: string, on: boolean): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (on) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
    setSavedPath(null)
  }

  const save = async (): Promise<void> => {
    const chosen = eligible.filter((skill) => selected.has(skill.id))
    if (chosen.length === 0) {
      return
    }
    setBusy(true)
    setError(null)
    setSavedPath(null)
    try {
      const outcome = await window.api.skills.exportBundle({
        skillIds: chosen.map((skill) => skill.id),
        bundleName: derivedBundleName(chosen),
        dialogTitle: translate('madang.skillShare.export.dialogTitle', 'Save skill bundle')
      })
      if (outcome.status === 'saved') {
        setSavedPath(outcome.path)
      } else if (outcome.status === 'error') {
        setError(exportErrorText(outcome.code))
      }
    } catch (cause) {
      console.warn('[skills] export failed:', cause)
      setError(exportErrorText('failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-3rem)] scrollbar-sleek overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{translate('madang.skillShare.export.title', 'Export skills')}</DialogTitle>
          <DialogDescription>
            {translate(
              'madang.skillShare.export.description',
              'Save the skills you select as one .tar.gz bundle. Import it on another computer with Import from file.'
            )}
          </DialogDescription>
        </DialogHeader>
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate(
              'madang.skillShare.export.empty',
              'No skills can be exported. Only skills installed on this computer in your home or a workspace can be exported.'
            )}
          </p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto scrollbar-sleek">
            {eligible.map((skill) => (
              <li key={skill.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(skill.id)}
                    disabled={busy}
                    onCheckedChange={(checked) => toggle(skill.id, checked === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{skill.name}</span>
                    {skill.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {skill.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {savedPath ? (
          <p className="break-all text-xs text-muted-foreground" role="status">
            {translate('madang.skillShare.export.saved', 'Saved: {{path}}', { path: savedPath })}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {translate('madang.skillShare.close', 'Close')}
          </Button>
          <Button type="button" disabled={busy || selected.size === 0} onClick={() => void save()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {translate('madang.skillShare.export.action', 'Export {{count}} skills', {
              count: selected.size
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
