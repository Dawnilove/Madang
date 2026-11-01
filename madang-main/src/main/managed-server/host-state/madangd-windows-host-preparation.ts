// Stage pinned Node and a content-addressed host script so Windows operations share verified bytes without replacing running clients' code.
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { ensureRemoteMadangdNodeRuntime } from '../install/madangd-remote-node-runtime'
import {
  installMadangdWindowsHostScript,
  madangdRemoteBaseDir
} from '../install/madangd-remote-windows-node'
import { materializeNodeRuntimeArchive } from '../../node-runtime/pinned-runtime-materializer'
import type { MadangdHostTransport } from '../../ssh/madangd-host-transport'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

export async function prepareWindowsMadangdHost(options: {
  conn: MadangdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  serverTarget: NodeRuntimeTarget
  signal?: AbortSignal
}): Promise<void> {
  const baseDir = madangdRemoteBaseDir(options.host, options.remoteHome)
  await ensureRemoteMadangdNodeRuntime({
    conn: options.conn,
    host: options.host,
    // The runtime store is a sibling of slots; only this synthetic slot's parent is used.
    slotDir: joinRemotePath(options.host, baseDir, 'madangd-host'),
    target: options.serverTarget,
    archivePath: () =>
      materializeNodeRuntimeArchive(
        options.serverTarget,
        join(getAppEnvironment().getPath('userData'), 'madangd-artifacts'),
        { signal: options.signal }
      ),
    signal: options.signal
  })
  await installMadangdWindowsHostScript(options, baseDir)
}
