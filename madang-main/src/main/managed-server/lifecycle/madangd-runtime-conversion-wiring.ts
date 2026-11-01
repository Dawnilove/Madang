import { encodePairingOffer } from '../../../shared/pairing'
import {
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { disconnectRegisteredSshTarget } from '../../ipc/ssh/ssh-session-teardown'
import type { MadangdMigrationDestinationCatalog } from '../../ssh/madangd-migration-cutover-coordinator'
import {
  abortRemoteMadangdMigrationCatalog,
  commitRemoteMadangdMigrationCatalog,
  listRemoteMadangdRepositories,
  readRemoteMadangdMigrationCatalogState,
  stageRemoteMadangdMigrationCatalog,
  stageRemoteMadangdMigrationSnapshotChunk
} from '../../ssh/madangd-migration-catalog-client'
import { abortRemoteMadangdMigrationCatalogByReference } from '../../ssh/madangd-migration-catalog-reference-client'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { isBridgeableLease } from '../../ssh/legacy-relay/legacy-relay-bridge-leases'
import type { MadangdManagedConversionArgs } from './madangd-runtime-conversion'
import type { MadangdServerRepository } from '../../ssh/madangd-migration-repository-link'
import {
  listRemoteMadangdFolderCatalog,
  type MadangdServerFolderCatalog
} from '../../ssh/madangd-server-folder-workspaces'

export function madangdMigrationDestinationFor(
  environment: KnownRuntimeEnvironment
): MadangdMigrationDestinationCatalog {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return {
    readState: (manifest) => readRemoteMadangdMigrationCatalogState(pairingCode, manifest, options),
    stage: (manifest) => stageRemoteMadangdMigrationCatalog(pairingCode, manifest, options),
    commit: (manifest) => commitRemoteMadangdMigrationCatalog(pairingCode, manifest, options),
    abort: (manifest) => abortRemoteMadangdMigrationCatalog(pairingCode, manifest, options),
    abortByReference: (manifest) =>
      abortRemoteMadangdMigrationCatalogByReference(pairingCode, manifest, options),
    stageChunk: (request) => stageRemoteMadangdMigrationSnapshotChunk(pairingCode, request, options)
  }
}

export function madangdServerRepositoriesFor(
  environment: KnownRuntimeEnvironment
): Promise<MadangdServerRepository[]> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteMadangdRepositories(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function madangdServerFolderCatalogFor(
  environment: KnownRuntimeEnvironment
): Promise<MadangdServerFolderCatalog> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteMadangdFolderCatalog(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function conversionCollaborators(): Pick<
  MadangdManagedConversionArgs,
  | 'destinationFor'
  | 'serverRepositoriesFor'
  | 'serverFolderCatalogFor'
  | 'censusHost'
  | 'isBridgedPaneLease'
  | 'releaseDirectSession'
> {
  return {
    destinationFor: madangdMigrationDestinationFor,
    serverRepositoriesFor: madangdServerRepositoriesFor,
    serverFolderCatalogFor: madangdServerFolderCatalogFor,
    censusHost: (target) => censusHostRelayTerminalsFor(target)(),
    isBridgedPaneLease: isBridgeableLease,
    releaseDirectSession: disconnectRegisteredSshTarget
  }
}
