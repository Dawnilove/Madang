// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SkillExportDialog } from './SkillExportDialog'
import { SkillShareMenu } from './SkillShareMenu'
import { SkillsPageHeader } from './SkillsPageHeader'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'api')
})

describe('skill sharing menu', () => {
  it('is on the skills page header while cloud account UI is off', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'api', { configurable: true, value: { skills: {} } })
    render(
      <TooltipProvider>
        <SkillsPageHeader
          skills={[]}
          local
          skillCount={0}
          sourceEntries={[]}
          scannedSourceCount={0}
          hostLabel={null}
          onClose={vi.fn()}
          onStartShare={vi.fn()}
          deleteSupported
          deleteUnsupportedReason={null}
          onStartDelete={vi.fn()}
          onInstallFromLink={vi.fn()}
          onManageInstalls={vi.fn()}
          onOpenSharedLinks={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.queryByRole('button', { name: 'Install from link' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Skill sharing' }))

    for (const name of [
      'Export skills…',
      'Import from file…',
      'Install from GitHub address…',
      'Import from Orca share link…'
    ]) {
      expect(await screen.findByRole('menuitem', { name })).toBeTruthy()
    }
  })

  it('opens the export dialog with only skills that can be shared from this computer', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'api', { configurable: true, value: { skills: {} } })
    const skill = (id: string, installed: boolean, sourceKind: string) =>
      ({ id, name: id, description: '', installed, sourceKind }) as never
    render(
      <SkillShareMenu
        local
        skills={[skill('mine', true, 'home'), skill('bundled', true, 'bundled')]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Skill sharing' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Export skills…' }))

    expect(await screen.findByRole('checkbox', { name: /mine/ })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: /bundled/ })).toBeNull()
  })

  it('exports the selected skills and shows where the bundle was saved', async () => {
    const user = userEvent.setup()
    const exportBundle = vi
      .fn()
      .mockResolvedValue({ status: 'saved', path: '/out/mine.tar.gz', skillCount: 1 })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { exportBundle } }
    })
    render(
      <SkillExportDialog
        open
        onOpenChange={vi.fn()}
        local
        skills={[
          {
            id: 'mine',
            name: 'mine',
            description: 'd',
            installed: true,
            sourceKind: 'home'
          } as never
        ]}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: /mine/ }))
    await user.click(screen.getByRole('button', { name: 'Export 1 skills' }))

    expect(exportBundle).toHaveBeenCalledWith(
      expect.objectContaining({ skillIds: ['mine'], bundleName: 'mine' })
    )
    expect((await screen.findByRole('status')).textContent).toContain('mine.tar.gz')
  })
})
