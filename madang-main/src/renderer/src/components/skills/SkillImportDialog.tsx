import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { parseGithubSkillUrl } from '../../../../shared/skill-github-url'
import { parseOrcaCompatSkillShareLink } from '../../../../shared/skills/orca-compat-skill-share'
import type { SkillCloudVersion } from '../../../../shared/skill-cloud-contract'
import type { SkillBundleManifestV1 } from '../../../../shared/skill-bundle-manifest'
import type {
  SkillImportErrorCode,
  SkillImportOutcome
} from '../../../../shared/skill-share-import-contract'
import { SkillBundleInstallFlow } from './SkillBundleInstallFlow'
import { skillImportErrorText, skillImportTitle, type SkillImportMode } from './skill-import-copy'

type BundleVersion = SkillCloudVersion & { manifest: SkillBundleManifestV1 }
type Staged = { importId: string; version: BundleVersion; skippedCount: number }
type Step = 'input' | 'confirm' | 'working' | 'review'

/**
 * One dialog for the three ways to bring a bundle in. Every way ends in the same install review
 * (`SkillBundleInstallFlow`); this component only gets a bundle staged in the main process.
 */
export function SkillImportDialog({
  mode,
  onClose
}: {
  mode: SkillImportMode
  onClose: () => void
}): React.JSX.Element {
  const [input, setInput] = useState('')
  const [step, setStep] = useState<Step>('input')
  const [error, setError] = useState<SkillImportErrorCode | null>(null)
  const [staged, setStaged] = useState<Staged | null>(null)
  const [flowBusy, setFlowBusy] = useState(false)
  const fileStarted = useRef(false)

  const run = useCallback(
    async (load: () => Promise<SkillImportOutcome>): Promise<void> => {
      setStep('working')
      setError(null)
      try {
        const outcome = await load()
        if (outcome.status === 'ready' && 'skills' in outcome.version.manifest) {
          setStaged({
            importId: outcome.importId,
            version: outcome.version as BundleVersion,
            skippedCount: outcome.skippedCount
          })
          setStep('review')
          return
        }
        if (outcome.status === 'cancelled' && mode === 'file') {
          onClose()
          return
        }
        setError(
          outcome.status === 'error' ? outcome.code : outcome.status === 'ready' ? 'failed' : null
        )
      } catch (cause) {
        console.warn('[skills] import failed:', cause)
        setError('failed')
      }
      setStep('input')
    },
    [mode, onClose]
  )

  const pickFile = useCallback(
    () =>
      run(() =>
        window.api.skills.importBundleFile({
          dialogTitle: translate('madang.skillShare.import.fileDialogTitle', 'Select skill bundle')
        })
      ),
    [run]
  )

  // The file picker opens by itself, once, when the file dialog appears.
  useEffect(() => {
    if (mode === 'file' && !fileStarted.current) {
      fileStarted.current = true
      void pickFile()
    }
  }, [mode, pickFile])

  const close = (): void => {
    if (staged) {
      void window.api.skills.releaseImport(staged.importId).catch(() => undefined)
    }
    onClose()
  }

  const submit = (): void => {
    if (mode === 'github') {
      if (!parseGithubSkillUrl(input)) {
        setError('invalid-url')
        return
      }
      void run(() => window.api.skills.importGithub({ url: input.trim() }))
    } else if (mode === 'orca') {
      // Checked on this side so a bad link never reaches the network, and so is a cancelled one.
      if (!parseOrcaCompatSkillShareLink(input)) {
        setError('invalid-url')
        return
      }
      setError(null)
      setStep('confirm')
    }
  }

  const busy = step === 'working' || flowBusy

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent
        className="max-h-[calc(100vh-3rem)] overflow-x-hidden overflow-y-auto scrollbar-sleek sm:max-w-xl [&>*]:min-w-0"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{skillImportTitle(mode)}</DialogTitle>
          {step === 'confirm' ? (
            <DialogDescription>
              {translate(
                'madang.skillShare.orca.warning',
                'This skill was made for Orca by a third party. Madang has not verified it.'
              )}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {step === 'working' ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            {mode === 'file'
              ? translate('madang.skillShare.import.checking', 'Checking the bundle…')
              : translate('madang.skillShare.import.fetching', 'Fetching skills…')}
          </p>
        ) : null}

        {step === 'confirm' ? (
          <>
            <p className="text-sm text-muted-foreground">
              {translate(
                'madang.skillShare.orca.detail',
                'If you continue, Madang connects to the Orca share service and downloads the bundle. You review the contents before anything is installed.'
              )}
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground">{input.trim()}</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {translate('madang.skillShare.cancel', 'Cancel')}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void run(() => window.api.skills.importCompatShare({ link: input.trim() }))
                }
              >
                {translate('madang.skillShare.orca.continue', 'Continue')}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === 'input' && mode === 'file' ? (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {translate('madang.skillShare.close', 'Close')}
            </Button>
            <Button type="button" onClick={() => void pickFile()}>
              {translate('madang.skillShare.import.chooseFile', 'Choose a file')}
            </Button>
          </DialogFooter>
        ) : null}

        {step === 'input' && (mode === 'github' || mode === 'orca') ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Label htmlFor="skill-import-input">
              {mode === 'github'
                ? translate('madang.skillShare.github.label', 'GitHub address')
                : translate('madang.skillShare.orca.label', 'Orca skill share link')}
            </Label>
            <Input
              id="skill-import-input"
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                setError(null)
              }}
              placeholder={
                mode === 'github'
                  ? 'https://github.com/owner/repository'
                  : 'https://…/skills/share/…'
              }
              className="font-mono text-xs"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {mode === 'github'
                ? translate(
                    'madang.skillShare.github.hint',
                    'Paste a repository or folder address. Madang finds folders that contain SKILL.md. Nothing is installed until you review it.'
                  )
                : translate(
                    'madang.skillShare.orca.hint',
                    'Paste a link made by Orca. Madang asks you to confirm before it connects.'
                  )}
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                {translate('madang.skillShare.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={input.trim() === ''}>
                {mode === 'github'
                  ? translate('madang.skillShare.github.find', 'Find skills')
                  : translate('madang.skillShare.orca.next', 'Next')}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {skillImportErrorText(error, mode)}
          </p>
        ) : null}

        {step === 'review' && staged ? (
          <>
            {staged.skippedCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'madang.skillShare.import.skipped',
                  '{{count}} folders with SKILL.md were left out because they could not be read safely.',
                  { count: staged.skippedCount }
                )}
              </p>
            ) : null}
            <SkillBundleInstallFlow
              importId={staged.importId}
              version={staged.version}
              onClose={close}
              onBusyChange={setFlowBusy}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
