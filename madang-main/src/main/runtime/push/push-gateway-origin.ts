import { cleanCloudServiceOrigin } from '../../../shared/cloud-service-url'

export function resolvePushGatewayOrigin(env: NodeJS.ProcessEnv, packaged: boolean): string {
  return cleanCloudServiceOrigin(env.MADANG_PUSH_GATEWAY_URL, !packaged) ?? '' // Madang: no default push gateway
}
