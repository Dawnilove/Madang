import { arch as osArch, platform as osPlatform, release as osRelease } from 'node:os'
import type { PostHog } from 'posthog-node'
import { getAppEnvironment } from '../../shared/app-environment'
import type { CommonProps, EventName } from '../../shared/telemetry-events'
import type { ConsentState } from './consent'

const OPT_OUT_CAPTURE_ENQUEUE_TIMEOUT_MS = 1_000

export function buildCommonProps(
  installId: string,
  sid: string,
  channel: 'stable' | 'rc'
): CommonProps {
  // Let authoritative max(64) validation drop overlong versions; truncation would hide invalid data.
  return {
    app_version: getAppEnvironment().getVersion(),
    platform: osPlatform(),
    arch: osArch(),
    os_release: osRelease(),
    install_id: installId,
    session_id: sid,
    orca_channel: channel
  }
}

export function waitForCaptureEnqueue(
  client: PostHog,
  event: EventName,
  uuid: string
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let stopListening: (() => void) | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null

    const settle = (enqueued: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      stopListening?.()
      resolve(enqueued)
    }

    // Node SDK capture enqueues asynchronously; observe its event before opting out.
    stopListening = client.on('capture', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') {
        return
      }
      if (
        'event' in payload &&
        payload.event === event &&
        'uuid' in payload &&
        payload.uuid === uuid
      ) {
        settle(true)
      }
    })

    timeout = setTimeout(() => settle(false), OPT_OUT_CAPTURE_ENQUEUE_TIMEOUT_MS)
  })
}

/** Reapply SDK opt-out each boot for disabled users. Keep pending-banner SDK enabled so the direct Turn Off capture can enqueue before optOut. */
export function shouldOptOutSdkAtInit(consent: ConsentState): boolean {
  return consent.effective === 'disabled'
}

/** Madang has no telemetry endpoint, so no client is ever created. */
export function createPostHogClient(_writeKey: string, _consent: ConsentState): never {
  throw new Error('Madang does not send telemetry.')
}
