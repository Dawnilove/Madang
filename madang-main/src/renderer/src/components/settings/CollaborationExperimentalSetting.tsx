import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { useState } from 'react'
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
import { SettingsSwitch } from './SettingsFormControls'
import { getCollaborationExperimentalSearchEntry } from './collaboration-experimental-search'

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
