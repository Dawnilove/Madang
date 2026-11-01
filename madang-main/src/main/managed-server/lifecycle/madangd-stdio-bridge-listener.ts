import { createServer, type Socket } from 'node:net'
import type { MadangdStdioBridgeMode } from './madangd-stdio-bridge-script'
import {
  MadangdStdioBridgeBase64Encoder,
  MadangdStdioBridgeDecoder,
  type MadangdStdioBridgeSignal
} from './madangd-stdio-bridge-stream'
import type { RemoteCommandChannel } from '../install/remote-install-transport'
import type {
  PortForwardStartOptions,
  StartedPortForward
} from '../../ssh/port-forwarding/ssh-port-forward-provider'
import { listenForPortForward } from '../../ssh/port-forwarding/ssh2-port-forward-provider'

// OpenSSH defaults to 10 sessions; cap bridges at 8 to leave capacity for exec work.
export const MADANGD_STDIO_BRIDGE_MAX_CHANNELS = 8
const MADANGD_STDIO_BRIDGE_QUEUE_TIMEOUT_MS = 30_000

type MadangdStdioBridgeChannelFactory = () => Promise<{
  channel: RemoteCommandChannel
  mode: MadangdStdioBridgeMode
}>

export async function listenMadangdStdioBridge(
  options: PortForwardStartOptions,
  openChannel: MadangdStdioBridgeChannelFactory
): Promise<StartedPortForward> {
  const sockets = new Set<Socket>()
  const channels = new Set<RemoteCommandChannel>()
  const waiting: { socket: Socket; timer: ReturnType<typeof setTimeout> }[] = []
  let open = 0
  let closed = false

  const admitNext = (): void => {
    while (open < MADANGD_STDIO_BRIDGE_MAX_CHANNELS) {
      const next = waiting.shift()
      if (!next) {
        return
      }
      clearTimeout(next.timer)
      void bridgeSocket(next.socket)
    }
  }
  const release = (): void => {
    open -= 1
    admitNext()
  }

  const bridgeSocket = async (socket: Socket): Promise<void> => {
    if (closed || socket.destroyed) {
      return
    }
    open += 1
    let opened: Awaited<ReturnType<MadangdStdioBridgeChannelFactory>>
    try {
      opened = await openChannel()
    } catch {
      socket.destroy()
      release()
      return
    }
    const { channel, mode } = opened
    channel.once('close', release)
    if (closed || socket.destroyed) {
      closeChannel(channel)
      return
    }
    channels.add(channel)
    channel.once('close', () => channels.delete(channel))
    pipeSocketThroughBridge(socket, channel, mode)
  }

  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    const entry = {
      socket,
      timer: setTimeout(() => socket.destroy(), MADANGD_STDIO_BRIDGE_QUEUE_TIMEOUT_MS)
    }
    socket.on('close', () => {
      sockets.delete(socket)
      clearTimeout(entry.timer)
      const index = waiting.indexOf(entry)
      if (index !== -1) {
        waiting.splice(index, 1)
      }
    })
    waiting.push(entry)
    admitNext()
  })

  await listenForPortForward(server, options.localHost, options.localPort)
  const address = server.address()
  const localPort = typeof address === 'object' && address ? address.port : options.localPort
  const entry = {
    id: options.id,
    connectionId: options.connectionId,
    localPort,
    remoteHost: options.remoteHost,
    remotePort: options.remotePort,
    label: options.label
  }

  const close = (): Promise<void> => {
    if (closed) {
      return Promise.resolve()
    }
    closed = true
    for (const { timer } of waiting.splice(0)) {
      clearTimeout(timer)
    }
    for (const channel of channels) {
      closeChannel(channel)
    }
    for (const socket of sockets) {
      socket.destroy()
    }
    return new Promise((resolve) => server.close(() => resolve()))
  }
  return { entry, close, dispose: () => void close() }
}

function pipeSocketThroughBridge(
  socket: Socket,
  channel: RemoteCommandChannel,
  mode: MadangdStdioBridgeMode
): void {
  const decoder = new MadangdStdioBridgeDecoder(mode)
  // Refused dials close only their socket, matching forwarding-channel refusal.
  decoder.once('signal', (signal: MadangdStdioBridgeSignal) => {
    if (signal !== 'ready') {
      socket.destroy()
      closeChannel(channel)
    }
  })
  decoder.on('error', () => {
    socket.destroy()
    closeChannel(channel)
  })
  channel.pipe(decoder).pipe(socket)
  if (mode === 'base64') {
    socket.pipe(new MadangdStdioBridgeBase64Encoder()).pipe(channel)
  } else {
    socket.pipe(channel)
  }
  channel.stderr.resume()
  channel.on('error', () => socket.destroy())
  channel.on('close', () => {
    if (!socket.writableEnded) {
      socket.destroy()
    }
  })
  socket.on('close', () => closeChannel(channel))
}

function closeChannel(channel: RemoteCommandChannel): void {
  try {
    channel.close()
  } catch {
    // Ignore teardown callbacks after the host transport drops.
  }
}
