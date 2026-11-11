import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSegmentedControl, SettingsSwitch } from './SettingsFormControls'
import { DEFAULT_FINISHED_WORKER_ARCHIVE_MINUTES } from '@/lib/finished-worker-auto-archive'
import { getCollaborationExperimentalSearchEntry } from './collaboration-experimental-search'
import {
  ensureCollaborationSkill,
  useCollaborationSkillState,
  type CollaborationSkillState
} from '@/lib/collaboration-skill-install'

function CollaborationSkillStatus({
  skill
}: {
  skill: CollaborationSkillState
}): React.JSX.Element | null {
  if (skill.kind === 'unknown') {
    return null
  }
  if (skill.kind === 'failed') {
    return (
      <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
        <span className="min-w-0 break-words">
          {translate(
            'auto.components.settings.collaborationExperimental.installFailed',
            'Skill install failed: {{value0}}',
            { value0: skill.reason }
          )}
        </span>
        <Button size="sm" variant="outline" onClick={() => void ensureCollaborationSkill()}>
          {translate('auto.components.settings.collaborationExperimental.retry', 'Retry')}
        </Button>
      </div>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      {skill.kind === 'checking'
        ? translate(
            'auto.components.settings.collaborationExperimental.checking',
            'Checking the collaboration skill…'
          )
        : translate(
            'auto.components.settings.collaborationExperimental.installed',
            'Collaboration skill installed'
          )}
    </p>
  )
}

const ARCHIVE_MINUTE_CHOICES = [0, 10, 30, 60] as const

function FinishedWorkerArchiveSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const label = translate(
    'auto.components.settings.collaborationExperimental.archiveLabel',
    'Archive finished worker terminals after'
  )
  return (
    <div className="space-y-1 pt-2">
      <p className="text-xs">{label}</p>
      <SettingsSegmentedControl
        size="sm"
        ariaLabel={label}
        value={settings.finishedWorkerArchiveMinutes ?? DEFAULT_FINISHED_WORKER_ARCHIVE_MINUTES}
        onChange={(minutes) => updateSettings({ finishedWorkerArchiveMinutes: minutes })}
        options={ARCHIVE_MINUTE_CHOICES.map((minutes) => ({
          value: minutes,
          label:
            minutes === 0
              ? translate('auto.components.settings.collaborationExperimental.archiveOff', 'Off')
              : translate(
                  'auto.components.settings.collaborationExperimental.archiveMinutes',
                  '{{value0}} min',
                  { value0: minutes }
                )
        }))}
      />
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.collaborationExperimental.archiveHint',
          'Closes a terminal worker tab after its task is done and it stays idle. Resume it from session history.'
        )}
      </p>
    </div>
  )
}

export function CollaborationExperimentalSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const entry = getCollaborationExperimentalSearchEntry()
  const enabled = settings.experimentalCollaboration === true
  const [guideOpen, setGuideOpen] = useState(false)
  const skill = useCollaborationSkillState()
  // Why: the switch and the installed stub are separate facts; re-check whenever this setting is shown ON.
  useEffect(() => {
    if (enabled) {
      void ensureCollaborationSkill()
    }
  }, [enabled])
  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="flex items-start justify-between gap-4 py-2"
      id="collaboration-rules"
    >
      <div className="min-w-0 shrink space-y-0.5">
        <Label>{entry.title}</Label>
        <p className="text-xs text-muted-foreground">{entry.description}</p>
        {enabled ? <CollaborationSkillStatus skill={skill} /> : null}
        <FinishedWorkerArchiveSetting settings={settings} updateSettings={updateSettings} />
      </div>
      <SettingsSwitch
        checked={enabled}
        ariaLabel={translate(
          'auto.components.settings.collaborationExperimental.toggleLabel',
          'Toggle collaboration rules'
        )}
        onChange={() => {
          updateSettings({ experimentalCollaboration: !enabled })
          // Show how to start a collaboration session each time the switch turns on.
          if (!enabled) {
            setGuideOpen(true)
          }
        }}
      />
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {translate(
                'auto.components.settings.collaborationExperimental.guideTitle',
                'How to use collaboration rules'
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {translate(
                'auto.components.settings.collaborationExperimental.guideBody',
                'Start the first message of a session with "협업:". Example: "협업: 로그인 화면을 만들어 줘". That session becomes the lead and splits the work among agents.'
              )}
            </DialogDescription>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.collaborationExperimental.guideNewSession',
                'The collaboration skill is installed when you turn this on. It applies from the next new session.'
              )}
            </p>
            <CollaborationSkillStatus skill={skill} />
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setGuideOpen(false)}>
              {translate('auto.components.settings.collaborationExperimental.guideConfirm', 'OK')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SearchableSetting>
  )
}
