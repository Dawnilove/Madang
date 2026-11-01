// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillCloudVersion } from '../../../../shared/skill-cloud-contract'
import { useAppStore } from '@/store'
import { SkillImportDialog } from './SkillImportDialog'

const DIGEST = 'c'.repeat(64)
const IMPORT_ID = '11111111-1111-4111-8111-111111111111'

function bundleVersion(): SkillCloudVersion {
  const skill = (id: string) => ({
    id,
    name: id,
    description: `${id} description`,
    digest: DIGEST,
    files: [
      {
        path: 'SKILL.md',
        size: 1,
        executable: false,
        classification: 'text' as const,
        sha256: DIGEST,
        identitySha256: DIGEST
      }
    ]
  })
  return {
    packageId: 'pkg_1',
    versionId: 'ver_1',
    name: 'team-bundle',
    description: 'Two skills',
    packageDigest: DIGEST,
    archiveSha256: 'b'.repeat(64),
    compressedBytes: 128,
    createdAt: '2026-08-11T00:00:00.000Z',
    releaseNotes: '',
    manifest: {
      schemaVersion: 1,
      packageId: 'pkg_1',
      versionId: 'ver_1',
      bundleName: 'team-bundle',
      description: 'Two skills',
      createdAt: '2026-08-11T00:00:00.000Z',
      skills: [skill('alpha'), skill('beta')],
      bundleDigest: DIGEST
    }
  }
}

function api(overrides: Record<string, unknown> = {}) {
  const skills = {
    importBundleFile: vi.fn(),
    importGithub: vi.fn(),
    importCompatShare: vi.fn(),
    installImportedBundle: vi.fn(),
    releaseImport: vi.fn().mockResolvedValue(undefined),
    previewBundleInstall: vi.fn().mockResolvedValue({
      status: 'ok',
      value: {
        packageId: 'pkg_1',
        versionId: 'ver_1',
        bundleDigest: DIGEST,
        destinationIdentity: 'local:global',
        skills: [
          { id: 'alpha', name: 'alpha', digest: DIGEST, currentState: 'missing' },
          { id: 'beta', name: 'beta', digest: DIGEST, currentState: 'missing' }
        ]
      }
    }),
    cancelInstall: vi.fn(),
    listWslDistros: vi.fn().mockResolvedValue([]),
    onInstallProgress: vi.fn(() => () => undefined),
    ...overrides
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      skills,
      preflight: {
        detectAgents: vi.fn().mockResolvedValue(['codex']),
        detectRemoteAgents: vi.fn().mockResolvedValue(['codex'])
      }
    }
  })
  return skills
}

beforeEach(() => {
  useAppStore.setState({
    runtimeEnvironments: [],
    runtimeStatusByEnvironmentId: new Map(),
    repos: [],
    worktreesByRepo: {},
    folderWorkspaces: [],
    sshConnectionStates: new Map(),
    sshTargetLabels: new Map()
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

function paste(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('SkillImportDialog', () => {
  describe('Orca-compatible link', () => {
    it('asks for confirmation first and makes no request when the user cancels', async () => {
      const skills = api()
      const onClose = vi.fn()
      render(<SkillImportDialog mode="orca" onClose={onClose} />)

      paste('Orca skill share link', 'https://app.orca.dev/skills/share/abc123')
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))

      await screen.findByText(
        'This skill was made for Orca by a third party. Madang has not verified it.'
      )
      expect(skills.importCompatShare).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onClose).toHaveBeenCalled()
      expect(skills.importCompatShare).not.toHaveBeenCalled()
      expect(skills.importGithub).not.toHaveBeenCalled()
    })

    it('rejects a link that is not an Orca share link without any request', () => {
      const skills = api()
      render(<SkillImportDialog mode="orca" onClose={() => undefined} />)

      paste('Orca skill share link', 'https://evil.example/skills/share/abc123')
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))

      expect(screen.getByRole('alert').textContent).toBe('This is not an Orca skill share link.')
      expect(screen.queryByText(/third party/)).toBeNull()
      expect(skills.importCompatShare).not.toHaveBeenCalled()
    })

    it('fetches only after confirmation and then shows the normal install review', async () => {
      const skills = api()
      skills.importCompatShare.mockResolvedValue({
        status: 'ready',
        importId: IMPORT_ID,
        version: bundleVersion(),
        skippedCount: 0
      })
      skills.installImportedBundle.mockResolvedValue({
        status: 'ok',
        value: {
          operationId: 'op_1',
          packageId: 'pkg_1',
          versionId: 'ver_1',
          bundleDigest: DIGEST,
          status: 'complete',
          skills: [
            {
              skillId: 'alpha',
              name: 'alpha',
              digest: DIGEST,
              status: 'installed',
              placements: []
            }
          ]
        }
      })
      render(<SkillImportDialog mode="orca" onClose={() => undefined} />)

      paste('Orca skill share link', ' https://app.orca.dev/skills/share/abc123 ')
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

      await waitFor(() =>
        expect(skills.importCompatShare).toHaveBeenCalledWith({
          link: 'https://app.orca.dev/skills/share/abc123'
        })
      )
      await screen.findByText('alpha description')
      fireEvent.click(screen.getByRole('checkbox', { name: /beta/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Install 1 skill' }))

      await screen.findByText('Skills installed and verified.')
      expect(skills.installImportedBundle).toHaveBeenCalledWith(
        expect.objectContaining({ importId: IMPORT_ID, selectedSkillIds: ['alpha'] })
      )
    })
  })

  describe('file', () => {
    it('opens the file dialog once and goes to the install review', async () => {
      const skills = api()
      skills.importBundleFile.mockResolvedValue({
        status: 'ready',
        importId: IMPORT_ID,
        version: bundleVersion(),
        skippedCount: 0
      })
      render(<SkillImportDialog mode="file" onClose={() => undefined} />)

      await screen.findByText('alpha description')
      expect(skills.importBundleFile).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Install 2 skills' })).toBeTruthy()
    })

    it('closes when the user cancels the file dialog', async () => {
      const skills = api()
      skills.importBundleFile.mockResolvedValue({ status: 'cancelled' })
      const onClose = vi.fn()
      render(<SkillImportDialog mode="file" onClose={onClose} />)
      await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    it('explains a file that is not a bundle and lets the user choose again', async () => {
      const skills = api()
      skills.importBundleFile.mockResolvedValue({ status: 'error', code: 'file-invalid' })
      render(<SkillImportDialog mode="file" onClose={() => undefined} />)

      expect((await screen.findByRole('alert')).textContent).toMatch(/not a valid skill bundle/)
      fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }))
      await waitFor(() => expect(skills.importBundleFile).toHaveBeenCalledTimes(2))
    })
  })

  describe('GitHub address', () => {
    it('rejects an address that is not on github.com without any request', () => {
      const skills = api()
      render(<SkillImportDialog mode="github" onClose={() => undefined} />)

      paste('GitHub address', 'https://gitlab.com/owner/repo')
      fireEvent.click(screen.getByRole('button', { name: 'Find skills' }))

      expect(screen.getByRole('alert').textContent).toMatch(/github\.com\/owner\/repository/)
      expect(skills.importGithub).not.toHaveBeenCalled()
    })

    it('sends a valid address and shows the missing-skills message', async () => {
      const skills = api()
      skills.importGithub.mockResolvedValue({ status: 'error', code: 'no-skills' })
      render(<SkillImportDialog mode="github" onClose={() => undefined} />)

      paste('GitHub address', 'https://github.com/owner/repo/tree/main/skills')
      fireEvent.click(screen.getByRole('button', { name: 'Find skills' }))

      expect((await screen.findByRole('alert')).textContent).toMatch(/No skills were found/)
      expect(skills.importGithub).toHaveBeenCalledWith({
        url: 'https://github.com/owner/repo/tree/main/skills'
      })
    })
  })

  it('releases the staged bundle when the review is closed', async () => {
    const skills = api()
    skills.importGithub.mockResolvedValue({
      status: 'ready',
      importId: IMPORT_ID,
      version: bundleVersion(),
      skippedCount: 2
    })
    const onClose = vi.fn()
    render(<SkillImportDialog mode="github" onClose={onClose} />)
    paste('GitHub address', 'https://github.com/owner/repo')
    fireEvent.click(screen.getByRole('button', { name: 'Find skills' }))
    await screen.findByText('alpha description')
    expect(screen.getByText(/2 folders with SKILL.md were left out/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    expect(skills.releaseImport).toHaveBeenCalledWith(IMPORT_ID)
    expect(onClose).toHaveBeenCalled()
  })
})
