import {
  MADANGD_BUILD_TARGET_FILENAME,
  MADANGD_LAUNCHER_FILENAME,
  MADANGD_SERVER_ENTRY_FILENAME,
  MADANGD_NODE_RUNTIME_DIR_PREFIX,
  MADANGD_NODE_RUNTIME_MARKER_FILENAME,
  MADANGD_NODE_RUNTIME_POSIX_EXECUTABLE,
  MADANGD_RUNTIMES_DIRNAME,
  madangdBunRuntimeFilename
} from '../../../shared/madangd-artifacts'
import { assertPosixMadangdHost } from './madangd-remote-host-support'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

// Assign the long slot path once to reduce command size on the wire.
function assignMadangdSlot(directory: string): string {
  return `madangd_slot=${quotePosixShell(directory.replace(/\/+$/, ''))}; `
}

// Rollback must still accept legacy single-entry slots.
export function selectMadangdSlotEntryCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixMadangdHost(host)
  const server = `"$madangd_slot"/${quotePosixShell(MADANGD_SERVER_ENTRY_FILENAME)}`
  const launcher = `"$madangd_slot"/${quotePosixShell(MADANGD_LAUNCHER_FILENAME)}`
  return `${assignMadangdSlot(directory)}if [ -f ${server} ]; then madangd_entry=${server}; else madangd_entry=${launcher}; fi`
}

/** Set $madangd_runtime or exit 78; callers decide what an absent marker means. */
export function madangdNodeSlotRuntimeCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixMadangdHost(host)
  const nodeMarker = `"$madangd_slot"/${quotePosixShell(MADANGD_NODE_RUNTIME_MARKER_FILENAME)}`
  const nodeRuntimePrefix = `"\${madangd_slot%/*}"/${quotePosixShell(
    `${MADANGD_RUNTIMES_DIRNAME}/${MADANGD_NODE_RUNTIME_DIR_PREFIX}`
  )}`
  const nodeExecutable = quotePosixShell(`/${MADANGD_NODE_RUNTIME_POSIX_EXECUTABLE}`)
  return (
    `${assignMadangdSlot(directory)}madangd_node_sha=$(cat ${nodeMarker}) || exit 78; ` +
    // The digest becomes a path segment; reject non-SHA256 values.
    // Leading ( keeps the case pattern parseable inside command substitution.
    'case "$madangd_node_sha" in ("" | *[!0-9a-f]*) exit 78;; esac; ' +
    '[ "${#madangd_node_sha}" -eq 64 ] || exit 78; ' +
    `madangd_runtime=${nodeRuntimePrefix}"$madangd_node_sha"${nodeExecutable}; ` +
    '[ -x "$madangd_runtime" ] || exit 78; '
  )
}

/** Legacy host Node fallback must never hide an incomplete Node or Bun slot. */
export function selectMadangdSlotRuntimeCommand(
  host: RemoteHostPlatform,
  directory: string,
  legacyNodePath: string
): string {
  assertPosixMadangdHost(host)
  const nodeMarker = quotePosixShell(
    joinRemotePath(host, directory, MADANGD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const runtime = quotePosixShell(joinRemotePath(host, directory, madangdBunRuntimeFilename(host.os)))
  const target = quotePosixShell(joinRemotePath(host, directory, MADANGD_BUILD_TARGET_FILENAME))
  return (
    `if [ -e ${nodeMarker} ]; then ${madangdNodeSlotRuntimeCommand(host, directory)}` +
    `elif [ -e ${target} ] || [ -e ${runtime} ]; then ` +
    `[ -x ${runtime} ] || exit 78; madangd_runtime=${runtime}; ` +
    `else madangd_runtime=${quotePosixShell(legacyNodePath)}; fi`
  )
}
