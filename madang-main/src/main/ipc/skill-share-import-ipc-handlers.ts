import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { parseGithubSkillUrl } from '../../shared/skill-github-url'
import { parseOrcaCompatSkillShareLink } from '../../shared/skills/orca-compat-skill-share'
import type {
  SkillBundleInstallRequest,
  SkillBundleInstallResult
} from '../../shared/skill-bundle-install-contract'
import type {
  SkillExportOutcome,
  SkillImportOutcome
} from '../../shared/skill-share-import-contract'
import type { SkillDiscoveryResult, SkillDiscoveryTargetSchema } from '../../shared/skills'
import type { SkillBundleShareInstallOperation } from '../../shared/skill-sharing-contract'
import type { OrcaRuntimeService } from '../runtime/madang-runtime'
import { exportSkillBundle, skillExportErrorCode } from '../skills/skill-bundle-file-export'
import { inspectSkillBundleFile, type ImportedBundle } from '../skills/skill-bundle-file-import'
import { importSkillsFromCompatShare } from '../skills/skill-compat-share-import'
import { importSkillsFromGithub } from '../skills/skill-github-import'
import { skillImportErrorCode } from '../skills/skill-import-error'
import { SkillImportRegistry, type StagedSkillImport } from '../skills/skill-import-registry'
import { skillInstallFailureFromError } from '../skills/skill-install-operation-error'
import { skillCloudBundleShareInstallSchema } from './skill-cloud-install-ipc-schemas'
import { sendBundleInstallProgress, sendSkillInstallProgress } from './skill-install-progress-ipc'
import { handleMainWindowSkillIpc } from './skill-ipc-main-window'

const BUNDLE_FILTER = [{ name: 'Madang skill bundle (.tar.gz)', extensions: ['gz', 'tgz'] }]
const LOCAL_ONLY_MESSAGE = 'Imported bundles can be installed on this computer only.'
const titleSchema = z.object({ dialogTitle: z.string().max(120).optional() }).strict()
const exportSchema = z
  .object({
    skillIds: z.array(z.string().min(1).max(512)).min(1).max(512),
    bundleName: z.string().min(1).max(64),
    dialogTitle: z.string().max(120).optional()
  })
  .strict()
const installSchema = skillCloudBundleShareInstallSchema
  .omit({ shareId: true, versionId: true })
  .extend({ importId: z.uuid() })

function parentWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined
}

async function stageBundle(
  registry: SkillImportRegistry,
  load: () => Promise<ImportedBundle & { skippedCount?: number }>
): Promise<SkillImportOutcome> {
  try {
    const bundle = await load()
    const importId = await registry.stage(bundle)
    return {
      status: 'ready',
      importId,
      version: bundle.version,
      skippedCount: bundle.skippedCount ?? 0
    }
  } catch (error) {
    console.warn('[skills] import failed:', error)
    return { status: 'error', code: skillImportErrorCode(error) }
  }
}

function failedInstall(
  staged: StagedSkillImport,
  request: SkillBundleInstallRequest,
  failure: NonNullable<ReturnType<typeof skillInstallFailureFromError>>
): SkillBundleInstallResult {
  const manifest = staged.version.manifest
  if (!('skills' in manifest)) {
    throw new Error('skill-bundle-cloud-manifest-required')
  }
  const status = failure.category === 'cancelled' ? ('cancelled' as const) : ('failed' as const)
  const selected = new Set(request.selectedSkillIds)
  return {
    operationId: request.operationId,
    packageId: request.package.packageId,
    versionId: request.package.versionId,
    bundleDigest: request.package.bundleDigest,
    status,
    skills: manifest.skills
      .filter((skill) => selected.has(skill.id))
      .map((skill) => ({
        skillId: skill.id,
        name: skill.name,
        digest: skill.digest,
        status,
        placements: [],
        errorCategory: failure.code,
        failure
      }))
  }
}

async function installImported(
  runtime: OrcaRuntimeService,
  registry: SkillImportRegistry,
  event: IpcMainInvokeEvent,
  value: unknown
): Promise<SkillBundleShareInstallOperation> {
  const input = installSchema.parse(value)
  const staged = registry.get(input.importId)
  if (!staged || !('skills' in staged.version.manifest)) {
    throw new Error('skill-import-expired')
  }
  if (input.environmentId) {
    return { status: 'unsupported', message: LOCAL_ONLY_MESSAGE }
  }
  const request: SkillBundleInstallRequest = {
    operationId: input.operationId ?? randomUUID(),
    package: {
      packageId: staged.version.packageId,
      versionId: staged.version.versionId,
      bundleDigest: staged.version.manifest.bundleDigest,
      archiveSha256: staged.version.archiveSha256,
      compressedBytes: staged.version.compressedBytes
    },
    selectedSkillIds: input.selectedSkillIds,
    // The path comes from the registry, which only holds files the user picked or Madang built.
    ingress: { kind: 'local-file', path: staged.archivePath },
    destination: input.destination,
    ...(input.providers ? { providers: input.providers } : {}),
    conflictDecisions: input.conflictDecisions ?? []
  }
  sendSkillInstallProgress(event, { operationId: request.operationId, phase: 'installing' })
  try {
    const result = await runtime.installSharedSkillBundleRequest(
      request,
      undefined,
      (progress) => sendBundleInstallProgress(event, progress),
      { allowTrustedLocalFile: true }
    )
    return { status: 'ok', value: result }
  } catch (error) {
    const failure = skillInstallFailureFromError(error)
    if (!failure) {
      throw error
    }
    return { status: 'ok', value: failedInstall(staged, request, failure) }
  }
}

export function registerSkillShareImportIpcHandlers(
  runtime: OrcaRuntimeService,
  discover: (target?: z.infer<typeof SkillDiscoveryTargetSchema>) => Promise<SkillDiscoveryResult>
): void {
  const registry = new SkillImportRegistry()
  app.once('will-quit', () => void registry.releaseAll())

  handleMainWindowSkillIpc(
    'skills:exportBundle',
    async (event, value: unknown): Promise<SkillExportOutcome> => {
      const input = exportSchema.parse(value)
      const requested = new Set(input.skillIds)
      const skills = (await discover()).skills.filter((skill) => requested.has(skill.id))
      if (skills.length !== requested.size) {
        return { status: 'error', code: 'failed' }
      }
      const options = {
        title: input.dialogTitle,
        defaultPath: `${input.bundleName}.tar.gz`,
        filters: BUNDLE_FILTER
      }
      const window = parentWindow(event)
      const chosen = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (chosen.canceled || !chosen.filePath) {
        return { status: 'cancelled' }
      }
      const archivePath = /\.(tar\.gz|tgz)$/i.test(chosen.filePath)
        ? chosen.filePath
        : `${chosen.filePath}.tar.gz`
      try {
        await exportSkillBundle({ skills, bundleName: input.bundleName, archivePath })
        return { status: 'saved', path: archivePath, skillCount: skills.length }
      } catch (error) {
        console.warn('[skills] export failed:', error)
        return { status: 'error', code: skillExportErrorCode(error) }
      }
    }
  )

  handleMainWindowSkillIpc(
    'skills:importBundleFile',
    async (event, value: unknown): Promise<SkillImportOutcome> => {
      const options = {
        title: titleSchema.parse(value ?? {}).dialogTitle,
        properties: ['openFile' as const],
        filters: BUNDLE_FILTER
      }
      const window = parentWindow(event)
      const chosen = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      if (chosen.canceled || chosen.filePaths.length !== 1) {
        return { status: 'cancelled' }
      }
      return stageBundle(registry, () => inspectSkillBundleFile(chosen.filePaths[0]))
    }
  )

  handleMainWindowSkillIpc(
    'skills:importGithub',
    async (_event, value: unknown): Promise<SkillImportOutcome> => {
      const { url } = z
        .object({ url: z.string().min(1).max(2048) })
        .strict()
        .parse(value)
      const source = parseGithubSkillUrl(url)
      return source
        ? stageBundle(registry, () => importSkillsFromGithub(source))
        : { status: 'error', code: 'invalid-url' }
    }
  )

  // The renderer calls this only after the user confirmed the third-party warning.
  handleMainWindowSkillIpc(
    'skills:importCompatShare',
    async (_event, value: unknown): Promise<SkillImportOutcome> => {
      const { link } = z
        .object({ link: z.string().min(1).max(2048) })
        .strict()
        .parse(value)
      const shareId = parseOrcaCompatSkillShareLink(link)
      return shareId
        ? stageBundle(registry, () =>
            importSkillsFromCompatShare(shareId, {
              temporaryRoot: join(app.getPath('userData'), 'skill-installs', 'downloads')
            })
          )
        : { status: 'error', code: 'invalid-url' }
    }
  )

  handleMainWindowSkillIpc('skills:installImportedBundle', (event, value: unknown) =>
    installImported(runtime, registry, event, value)
  )
  handleMainWindowSkillIpc('skills:releaseImport', (_event, importId: unknown) =>
    registry.release(z.uuid().parse(importId))
  )
}
