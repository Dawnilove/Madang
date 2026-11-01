/** Opaque migration blobs travel beside the signed catalog. Gate each kind by its destination capability:
 * older destinations drop unknown kinds, so clients must refuse before staging. */
import { z } from 'zod'
import {
  MADANGD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  MadangdMigrationChunkBase64Schema,
  MadangdMigrationDigestSchema,
  MadangdMigrationIdentitySchema,
  decodeMadangdMigrationChunk
} from './madangd-migration-scrollback'
import { requiredRecord } from './madangd-migration-dormant-value-validation'
import { assertUniqueKeys } from './madangd-migration-manifest-fields'
import { MADANGD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY } from '../madangd-runtime-capabilities'

export const MADANGD_MIGRATION_BLOB_KINDS = [
  'terminal-restore-hints',
  'shell-history',
  'agent-session-records'
] as const

export type MadangdMigrationBlobKind = (typeof MADANGD_MIGRATION_BLOB_KINDS)[number]

type MadangdMigrationBlobKindContract = {
  /** Filename-safe, dot-free and lowercase, so a key is one path segment on any filesystem. */
  key: RegExp
  maxBytes: number
  capability: string
}

const MIB = 1024 * 1024

export const MADANGD_MIGRATION_BLOB_KIND_CONTRACTS: Record<
  MadangdMigrationBlobKind,
  MadangdMigrationBlobKindContract
> = {
  // One JSON document per migration; the received directory already scopes it to the migration.
  'terminal-restore-hints': {
    key: /^migration$/,
    maxBytes: 4 * MIB,
    capability: 'madangd.migration-blob.terminal-restore-hints.v1'
  },
  // `hashWorktreeId` (16 hex) plus the shell whose history file it is.
  'shell-history': {
    key: /^[a-f0-9]{16}-(?:zsh|bash|fish)$/,
    maxBytes: 64 * MIB,
    capability: 'madangd.migration-blob.shell-history.v1'
  },
  // The agent session id; agent CLIs mint lowercase UUID-like ids.
  'agent-session-records': {
    key: /^[a-z0-9][a-z0-9_-]{0,127}$/,
    maxBytes: 64 * MIB,
    capability: 'madangd.migration-blob.agent-session-records.v1'
  }
}

// The same bound the shared chunk decoder enforces for both channels.
export const MADANGD_MIGRATION_BLOB_CHUNK_BYTES = MADANGD_MIGRATION_SCROLLBACK_CHUNK_BYTES
export const MAX_MADANGD_MIGRATION_BLOBS = 1024
export const MAX_MADANGD_MIGRATION_BLOB_TOTAL_BYTES = 256 * MIB

/** Byte-for-byte what the destination must hold; empty content is sent as no blob at all. */
export type MadangdMigrationBlobDescriptor = {
  blobKind: MadangdMigrationBlobKind
  key: string
  sha256: string
  byteLength: number
}

export type MadangdMigrationBlobUploadState = MadangdMigrationBlobDescriptor & {
  receivedBytes: number
}

export const MADANGD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED =
  'madangd_migration_destination_blob_kind_unsupported'

// Windows refuses these as file names whatever the extension, so a key must never be one.
const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

export const MadangdMigrationBlobDescriptorSchema = z
  .object({
    blobKind: z.enum(MADANGD_MIGRATION_BLOB_KINDS),
    key: z.string().max(256),
    sha256: MadangdMigrationDigestSchema,
    byteLength: z.number().int().min(1)
  })
  .superRefine((value, context) => {
    const contract = MADANGD_MIGRATION_BLOB_KIND_CONTRACTS[value.blobKind]
    if (!contract.key.test(value.key) || WINDOWS_RESERVED_FILE_NAME.test(value.key)) {
      context.addIssue({
        code: 'custom',
        message: 'madangd_migration_blob_key_invalid'
      })
    }
    if (value.byteLength > contract.maxBytes) {
      context.addIssue({ code: 'custom', message: 'madangd_migration_blob_too_large' })
    }
  })

// Not strict: an older host must ignore optional fields a newer client adds.
export const MadangdMigrationBlobChunkRequestSchema = z.object({
  migrationId: MadangdMigrationIdentitySchema,
  manifestSha256: MadangdMigrationDigestSchema,
  blob: MadangdMigrationBlobDescriptorSchema,
  offset: z.number().int().nonnegative().max(MAX_MADANGD_MIGRATION_BLOB_TOTAL_BYTES),
  bytesBase64: MadangdMigrationChunkBase64Schema
})

export type MadangdMigrationBlobChunkRequest = z.infer<typeof MadangdMigrationBlobChunkRequestSchema>

export type MadangdMigrationBlobChunkResult = {
  migrationId: string
  manifestSha256: string
  blobKind: MadangdMigrationBlobKind
  key: string
  receivedBytes: number
}

export function parseMadangdMigrationBlobDescriptor(value: unknown): MadangdMigrationBlobDescriptor {
  const parsed = MadangdMigrationBlobDescriptorSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'madangd_migration_blob_descriptor_invalid')
  }
  return {
    blobKind: parsed.data.blobKind,
    key: parsed.data.key,
    sha256: parsed.data.sha256,
    byteLength: parsed.data.byteLength
  }
}

export function assertMadangdMigrationBlobSet(
  descriptors: readonly MadangdMigrationBlobDescriptor[]
): void {
  if (descriptors.length > MAX_MADANGD_MIGRATION_BLOBS) {
    throw new Error('madangd_migration_blobs_too_many')
  }
  assertUniqueKeys([...descriptors], madangdMigrationBlobIdentity, 'madangd_migration_blob_duplicate')
  const total = descriptors.reduce((sum, entry) => sum + entry.byteLength, 0)
  if (total > MAX_MADANGD_MIGRATION_BLOB_TOTAL_BYTES) {
    throw new Error('madangd_migration_blobs_too_large')
  }
}

export function madangdMigrationBlobIdentity(
  descriptor: Pick<MadangdMigrationBlobDescriptor, 'blobKind' | 'key'>
): string {
  return `${descriptor.blobKind}\0${descriptor.key}`
}

export function sameMadangdMigrationBlob(
  left: MadangdMigrationBlobDescriptor,
  right: MadangdMigrationBlobDescriptor
): boolean {
  return (
    left.blobKind === right.blobKind &&
    left.key === right.key &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  )
}

/** The channel plus each kind's capability; empty when nothing is sent. */
export function requiredMigrationBlobCapabilities(
  descriptors: readonly Pick<MadangdMigrationBlobDescriptor, 'blobKind'>[]
): string[] {
  if (descriptors.length === 0) {
    return []
  }
  const kinds = new Set(descriptors.map((entry) => entry.blobKind))
  return [
    MADANGD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...MADANGD_MIGRATION_BLOB_KINDS.filter((kind) => kinds.has(kind)).map(
      (kind) => MADANGD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability
    )
  ]
}

/** The first kind the destination cannot install, so the refusal names what would be lost. */
export function findUnsupportedMigrationBlobKind(
  descriptors: readonly Pick<MadangdMigrationBlobDescriptor, 'blobKind'>[],
  capabilities: readonly string[]
): MadangdMigrationBlobKind | null {
  const advertised = new Set(capabilities)
  for (const descriptor of descriptors) {
    if (
      !advertised.has(MADANGD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY) ||
      !advertised.has(MADANGD_MIGRATION_BLOB_KIND_CONTRACTS[descriptor.blobKind].capability)
    ) {
      return descriptor.blobKind
    }
  }
  return null
}

export function madangdMigrationBlobKindUnsupportedBlocker(kind: MadangdMigrationBlobKind): string {
  return `${MADANGD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED}:${kind}:Update Madang on this host to move this project's ${kind} to it.`
}

export function decodeMadangdMigrationBlobChunk(bytesBase64: string): Buffer {
  return decodeMadangdMigrationChunk(bytesBase64, 'madangd_migration_blob_chunk_invalid')
}

/** Absent on hosts that predate blobs or hold none staged; both mean every blob starts at 0. */
export function parseMadangdMigrationBlobUploadStates(
  value: unknown
): MadangdMigrationBlobUploadState[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.length > MAX_MADANGD_MIGRATION_BLOBS) {
    throw new Error('madangd_migration_blob_state_invalid')
  }
  const uploads = value.map((entry) => {
    // Fails closed on an unknown kind by design: only blobs this desktop staged can appear here.
    const record = requiredRecord(entry, 'madangd_migration_blob_state_invalid')
    const descriptor = parseMadangdMigrationBlobDescriptor(record)
    if (
      !Number.isSafeInteger(record.receivedBytes) ||
      Number(record.receivedBytes) < 0 ||
      Number(record.receivedBytes) > descriptor.byteLength
    ) {
      throw new Error('madangd_migration_blob_state_invalid')
    }
    return { ...descriptor, receivedBytes: Number(record.receivedBytes) }
  })
  assertMadangdMigrationBlobSet(uploads)
  return uploads
}

export function parseMadangdMigrationBlobChunkResult(
  value: unknown,
  request: MadangdMigrationBlobChunkRequest
): MadangdMigrationBlobChunkResult {
  const record = requiredRecord(value, 'madangd_migration_blob_chunk_result_invalid')
  const receivedBytes = request.offset + decodeMadangdMigrationBlobChunk(request.bytesBase64).length
  if (
    record.migrationId !== request.migrationId ||
    record.manifestSha256 !== request.manifestSha256 ||
    record.blobKind !== request.blob.blobKind ||
    record.key !== request.blob.key ||
    record.receivedBytes !== receivedBytes
  ) {
    throw new Error('madangd_migration_blob_chunk_result_invalid')
  }
  return {
    migrationId: request.migrationId,
    manifestSha256: request.manifestSha256,
    blobKind: request.blob.blobKind,
    key: request.blob.key,
    receivedBytes
  }
}

/** Kinds this build's destination installs after commit; each is added with its installer. */
export const MADANGD_MIGRATION_INSTALLABLE_BLOB_KINDS: readonly MadangdMigrationBlobKind[] = [
  'terminal-restore-hints',
  'shell-history'
]

export function advertisedMadangdMigrationBlobCapabilities(): string[] {
  return [
    MADANGD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    ...MADANGD_MIGRATION_INSTALLABLE_BLOB_KINDS.map(
      (kind) => MADANGD_MIGRATION_BLOB_KIND_CONTRACTS[kind].capability
    )
  ]
}
