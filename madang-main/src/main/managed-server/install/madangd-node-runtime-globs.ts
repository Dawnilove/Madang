import {
  MADANGD_NODE_RUNTIME_DIR_PREFIX,
  MADANGD_NODE_RUNTIME_POSIX_EXECUTABLE,
  MADANGD_RUNTIMES_DIRNAME
} from '../../../shared/madangd-artifacts'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import { MADANGD_MACHINE_HOMES_DIRNAME } from '../host-state/madangd-machine-home'

/** POSIX shell glob words for madangd's pinned Node runtimes; machine homes may hold other architectures, so callers must self-test each match. */
export function madangdPosixNodeRuntimeGlobs(): [string, string] {
  const store = `${RELAY_REMOTE_DIR}/${MADANGD_RUNTIMES_DIRNAME}/${MADANGD_NODE_RUNTIME_DIR_PREFIX}`
  const executable = `/${MADANGD_NODE_RUNTIME_POSIX_EXECUTABLE}`
  const machineStores = `${RELAY_REMOTE_DIR}/${MADANGD_MACHINE_HOMES_DIRNAME}/`
  return [
    `"$HOME"/${quotePosixShell(store)}*${quotePosixShell(executable)}`,
    `"$HOME"/${quotePosixShell(machineStores)}*/${quotePosixShell(store)}*${quotePosixShell(executable)}`
  ]
}
