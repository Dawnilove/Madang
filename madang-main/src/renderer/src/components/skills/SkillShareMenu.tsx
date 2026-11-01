import { useState } from 'react'
import { FileDown, Github, Link2, PackageOpen, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { DiscoveredSkill } from '../../../../shared/skills'
import { SkillExportDialog } from './SkillExportDialog'
import { SkillImportDialog } from './SkillImportDialog'
import type { SkillImportMode } from './skill-import-copy'

type OpenDialog = 'export' | SkillImportMode | null

/**
 * Madang's own ways to share skills without a server: a .tar.gz file, a GitHub address, or a link
 * made by Orca. Shown whether or not cloud accounts are enabled.
 */
export function SkillShareMenu({
  skills,
  local
}: {
  skills: readonly DiscoveredSkill[]
  local: boolean
}): React.JSX.Element {
  const [dialog, setDialog] = useState<OpenDialog>(null)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Share2 className="size-3.5" />
            {translate('madang.skillShare.menu.button', 'Skill sharing')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog('export')}>
            <FileDown />
            {translate('madang.skillShare.menu.export', 'Export skills…')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('file')}>
            <PackageOpen />
            {translate('madang.skillShare.menu.importFile', 'Import from file…')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('github')}>
            <Github />
            {translate('madang.skillShare.menu.github', 'Install from GitHub address…')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('orca')}>
            <Link2 />
            {translate('madang.skillShare.menu.orca', 'Import from Orca share link…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === 'export' ? (
        <SkillExportDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          skills={skills}
          local={local}
        />
      ) : null}
      {dialog && dialog !== 'export' ? (
        <SkillImportDialog mode={dialog} onClose={() => setDialog(null)} />
      ) : null}
    </>
  )
}
