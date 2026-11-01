import { MADANGD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/madangd-managed-launch-env'

type MadangdWsPortOptions = {
  wsPort?: number
  preferPinnedWsPort?: boolean
  requirePinnedWsPort?: boolean
}

/** Honor explicit ports; managed launches permit fallback because WSL distros share loopback. */
export function madangdWsPortOptions(
  port: number | undefined,
  env: NodeJS.ProcessEnv = process.env
): MadangdWsPortOptions {
  if (port === undefined) {
    return {}
  }
  const managed = Boolean(env[MADANGD_MANAGED_ACTIVATION_ROOT_ENV])
  return {
    wsPort: port,
    preferPinnedWsPort: true,
    ...(managed ? {} : { requirePinnedWsPort: true })
  }
}
