import type { Platform } from './MobileHero'
import { translate } from '@/i18n/i18n'
import { MADANG_DOCS_URL, MADANG_REPO_URL } from '../../../../shared/madang-features'

const MADANG_RELEASES_URL = `${MADANG_REPO_URL}/releases`

// iOS offers App Store and TestFlight tracks; Android has a single APK track.
export type IosChannel = 'stable' | 'preview'

export type InstallCopy = { ctaLabel: string; url: string }

export const ANDROID_INSTALL_GUIDE_URL = MADANG_DOCS_URL

const IOS_CHANNEL_COPY: Record<IosChannel, InstallCopy> = {
  stable: {
    ctaLabel: 'Open App Store',
    url: MADANG_RELEASES_URL
  },
  preview: {
    ctaLabel: 'Open TestFlight',
    url: MADANG_RELEASES_URL
  }
}

const ANDROID_COPY: InstallCopy = {
  ctaLabel: 'Download APK',
  url: MADANG_RELEASES_URL
}

export function getInstallCopy(platform: Platform, iosChannel: IosChannel): InstallCopy {
  return platform === 'ios' ? IOS_CHANNEL_COPY[iosChannel] : ANDROID_COPY
}

export function getChannelTagline(iosChannel: IosChannel): string {
  return iosChannel === 'preview'
    ? translate(
        'auto.components.mobile.mobile.platform.copy.preview.tagline',
        'Newest features, updated daily.'
      )
    : translate(
        'auto.components.mobile.mobile.platform.copy.stable.tagline',
        'The public release, updated weekly.'
      )
}
