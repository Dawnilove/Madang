import type { z } from 'zod'
import {
  MadangdMigrationCatalogParams,
  MadangdMigrationCatalogReferenceParams,
  MadangdMigrationCommitCatalogParams
} from '../../../../shared/rpc-contract/madangd-migration-params'
import { parseMadangdMigrationManifest } from '../../../../shared/madangd-migration/madangd-migration-manifest-validation'
import { MadangdMigrationSnapshotChunkRequestSchema } from '../../../../shared/madangd-migration/madangd-migration-scrollback'
import { MadangdMigrationBlobChunkRequestSchema } from '../../../../shared/madangd-migration/madangd-migration-blob-transfer'
import { assertMadangdMigrationManifestDigest } from '../../../madangd/madangd-migration-manifest-digest'
import { assertMadangdMigrationSourceServedHere } from '../../../madangd/madangd-migration-wsl-destination'
import { defineMethod, type RpcContext } from '../core'

export const MADANGD_MIGRATION_METHODS = [
  defineMethod({
    name: 'madangd.migration.stageCatalog',
    permission: 'host-admin',
    params: MadangdMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageMadangdMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'madangd.migration.commitCatalog',
    permission: 'host-admin',
    params: MadangdMigrationCommitCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.commitStagedMadangdMigrationCatalog(migrationManifest(params), {
        signal: context.signal,
        ...(params.expectedBlobs ? { expectedBlobs: params.expectedBlobs } : {})
      })
    }
  }),
  defineMethod({
    name: 'madangd.migration.stageSnapshotChunk',
    permission: 'host-admin',
    params: MadangdMigrationSnapshotChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageMadangdMigrationSnapshotChunk(params)
    }
  }),
  // A separate method, not a field on stageSnapshotChunk: an older host would strip the field and
  // stage the bytes as a snapshot.
  defineMethod({
    name: 'madangd.migration.stageBlobChunk',
    permission: 'host-admin',
    params: MadangdMigrationBlobChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageMadangdMigrationBlobChunk(params)
    }
  }),
  defineMethod({
    name: 'madangd.migration.abortCatalog',
    permission: 'host-admin',
    params: MadangdMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedMadangdMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  // Why a reference: a source fenced on a manifest no request can carry must still be releasable.
  defineMethod({
    name: 'madangd.migration.abortCatalogByReference',
    permission: 'host-admin',
    params: MadangdMigrationCatalogReferenceParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedMadangdMigrationCatalogByReference(params, {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'madangd.migration.catalogState',
    permission: 'host-admin',
    params: MadangdMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.getMadangdMigrationCatalogState(migrationManifest(params))
    }
  })
]

function migrationManifest(params: z.infer<typeof MadangdMigrationCatalogParams>) {
  const manifest = parseMadangdMigrationManifest(params.manifest)
  // Raw, not parsed: parsing drops fields this host predates, which a newer client signed.
  assertMadangdMigrationManifestDigest(params.manifest)
  assertMadangdMigrationSourceServedHere(manifest.source)
  return manifest
}

function requireMigrationRuntimeClient(context: RpcContext): void {
  if (context.clientKind !== 'runtime' || !context.pairedDeviceId) {
    throw new Error('madangd_migration_runtime_client_required')
  }
}
