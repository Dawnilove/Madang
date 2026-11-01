import type { WslMadangdLaunch } from './wsl-madangd-deploy'

type WslMadangdDeferredLaunch = Extract<WslMadangdLaunch, { outcome: 'deferred' }>

/** madangd installed an update it may not activate yet (live terminals); nothing is listening. */
export class WslMadangdLaunchDeferredError extends Error {
  constructor(readonly launch: WslMadangdDeferredLaunch) {
    super(launch.reason)
    this.name = 'WslMadangdLaunchDeferredError'
  }
}

export class WslMadangdConnectionSupersededError extends Error {
  constructor(distro: string) {
    super(`The connection to the WSL distro ${distro} was closed while it was being opened.`)
    this.name = 'WslMadangdConnectionSupersededError'
  }
}
