/** Check snapshot room before stopping a serving incumbent (#30491). */
import { madangdRemoteBaseDir } from '../managed-server/install/madangd-remote-windows-node'
import { execMadangdRemoteOr } from '../managed-server/install/madangd-remote-runtime-control'
import {
  MADANGD_STATE_SNAPSHOT_DIR,
  type MadangdActivationRecord
} from '../managed-server/activation/madangd-activation-record'
import {
  madangdSnapshotShortfallKb,
  madangdSnapshotShortfallMessage,
  madangdSnapshotSpaceCommand,
  parseMadangdSnapshotSpace
} from '../managed-server/host-state/madangd-state-snapshot-space'
import { joinRemotePath } from './ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import type { MadangdSlotOptions } from './madangd-recovery-slot'

export const MADANGD_SNAPSHOT_SPACE_INSUFFICIENT_CODE = 'madangd_snapshot_space_insufficient'

export function madangdSnapshotsRoot(options: Pick<MadangdSlotOptions, 'host' | 'remoteHome'>): string {
  return joinRemotePath(
    options.host,
    madangdRemoteBaseDir(options.host, options.remoteHome),
    MADANGD_STATE_SNAPSHOT_DIR
  )
}

/** Unknown room proceeds to authoritative capture; return a refusal only for proven insufficient space. */
export async function madangdSnapshotRoomRefusal(
  options: MadangdSlotOptions,
  record: MadangdActivationRecord,
  fullVersion: string
): Promise<string | null> {
  const baseDir = madangdRemoteBaseDir(options.host, options.remoteHome)
  const command = madangdSnapshotSpaceCommand(
    options.host,
    options.userDataDir,
    madangdSnapshotsRoot(options),
    baseDir,
    record.snapshot ? [record.snapshot.dirName] : []
  )
  if (!command) {
    return null
  }
  const space = parseMadangdSnapshotSpace(await measureRoom(options, command))
  const shortfall = madangdSnapshotShortfallKb(space)
  return space && shortfall !== null
    ? madangdSnapshotShortfallMessage(space, shortfall, {
        userDataDir: options.userDataDir,
        baseDir,
        fullVersion,
        active: record.active
      })
    : null
}

async function measureRoom(options: MadangdSlotOptions, command: string): Promise<string> {
  try {
    return await execMadangdRemoteOr(options, command)
  } catch (error) {
    // Unconfirmed read-only cleanup leaves room unknown; capture decides, unless caller cancelled.
    if (isUnconfirmedSshCommandTermination(error) && !options.signal?.aborted) {
      return ''
    }
    throw error
  }
}
