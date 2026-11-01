import type { SkillDiscoveryResult, SkillDiscoveryTarget } from '../../shared/skills'
import type {
  SkillCloudOperation,
  SkillCloudOwnedShare,
  SkillCloudPackageDetails
} from '../../shared/skill-cloud-contract'
import type {
  ManagedSkillInstallListOperation,
  SkillBundleInstallPreviewInput,
  SkillBundleInstallPreviewOperation,
  SkillBundlePackageVersionInstallInput,
  SkillBundleShareInstallInput,
  SkillBundleShareInstallOperation,
  SkillInstallCancelInput,
  SkillInstallPreviewInput,
  SkillInstallPreviewOperation,
  SkillInstallProgress,
  SkillPackageVersionInstallInput,
  SkillRemoveInput,
  SkillRemoveOperation,
  SkillShareInstallInput,
  SkillShareInstallOperation,
  SkillSharePreview,
  SkillShareProgress,
  SkillSharePublishInput,
  SkillSharePublishOperation,
  SkillShareResolvedOperation
} from '../../shared/skill-sharing-contract'
import type {
  BundledSkillExecuteRequest,
  BundledSkillInstallResult,
  BundledSkillPlan,
  BundledSkillPlanRequest
} from '../../shared/bundled-skill-plan'

import type {
  SkillExportOutcome,
  SkillImportOutcome,
  SkillImportedBundleInstallInput
} from '../../shared/skill-share-import-contract'
import type {
  SkillDeletePlan,
  SkillDeleteRequest,
  SkillDeleteResult
} from '../../shared/skill-delete-contract'

export type SkillsApi = {
  discover: (target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>
  /** This machine's plan for Orca's installed skills; paired hosts plan over RPC. */
  bundledPlan: (request?: BundledSkillPlanRequest) => Promise<BundledSkillPlan>
  bundledExecute: (request: BundledSkillExecuteRequest) => Promise<BundledSkillInstallResult>
  prepareShare: (input: {
    skillIds: string[]
    bundleName: string
    target?: SkillDiscoveryTarget
    packageId?: string
  }) => Promise<SkillSharePreview>
  publishShare: (input: SkillSharePublishInput) => Promise<SkillSharePublishOperation>
  cancelShare: (preparationId: string) => Promise<void>
  releaseShare: (preparationId: string) => Promise<void>
  resolveShare: (shareId: string) => Promise<SkillShareResolvedOperation>
  installShare: (input: SkillShareInstallInput) => Promise<SkillShareInstallOperation>
  installBundleShare: (
    input: SkillBundleShareInstallInput
  ) => Promise<SkillBundleShareInstallOperation>
  installBundlePackageVersion: (
    input: SkillBundlePackageVersionInstallInput
  ) => Promise<SkillBundleShareInstallOperation>
  installPackageVersion: (
    input: SkillPackageVersionInstallInput
  ) => Promise<SkillShareInstallOperation>
  cancelInstall: (input: SkillInstallCancelInput) => Promise<{ cancelled: boolean }>
  previewInstall: (input: SkillInstallPreviewInput) => Promise<SkillInstallPreviewOperation>
  previewBundleInstall: (
    input: SkillBundleInstallPreviewInput
  ) => Promise<SkillBundleInstallPreviewOperation>
  removeInstall: (input: SkillRemoveInput) => Promise<SkillRemoveOperation>
  /** Saves the chosen skills as a .tar.gz bundle at a path picked in the save dialog. */
  exportBundle: (input: {
    skillIds: string[]
    bundleName: string
    dialogTitle?: string
  }) => Promise<SkillExportOutcome>
  /** Opens the file dialog and checks the picked .tar.gz; nothing is installed yet. */
  importBundleFile: (input?: { dialogTitle?: string }) => Promise<SkillImportOutcome>
  importGithub: (input: { url: string }) => Promise<SkillImportOutcome>
  /** Contacts the Orca share service; call only after the user confirmed the warning. */
  importCompatShare: (input: { link: string }) => Promise<SkillImportOutcome>
  installImportedBundle: (
    input: SkillImportedBundleInstallInput
  ) => Promise<SkillBundleShareInstallOperation>
  releaseImport: (importId: string) => Promise<void>
  /** Always true on desktop; web clients may use a server predating skill deletion. */
  deleteSupported: () => Promise<boolean>
  previewDelete: (request: SkillDeleteRequest) => Promise<SkillDeletePlan>
  delete: (request: SkillDeleteRequest) => Promise<SkillDeleteResult>
  listManagedInstalls: (environmentId?: string) => Promise<ManagedSkillInstallListOperation>
  getPackage: (packageId: string) => Promise<SkillCloudOperation<SkillCloudPackageDetails>>
  listOwnedShares: () => Promise<SkillCloudOperation<SkillCloudOwnedShare[]>>
  revokeShare: (shareId: string) => Promise<SkillCloudOperation<void>>
  deletePackage: (packageId: string) => Promise<SkillCloudOperation<void>>
  listWslDistros: (environmentId?: string) => Promise<string[]>
  onInstallProgress: (callback: (progress: SkillInstallProgress) => void) => () => void
  onShareProgress: (callback: (progress: SkillShareProgress) => void) => () => void
}
