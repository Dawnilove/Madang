/**
 * Madang product switches. Madang runs without Orca company servers, so upstream features that
 * need them stay in the code but are switched off here. Flip a flag to bring a feature back.
 */
export const MADANG_FEATURES = {
  /** GitHub star prompts for the upstream Orca repository. */
  starPrompts: false,
  /** Orca Cloud sign-in, artifact sharing and skill sharing panes and buttons. */
  cloudAccountUi: false,
  /** Mobile relay (cloud) option; LAN pairing stays available. */
  mobileCloudRelay: false,
  /** Update nudge read from `whats-new/nudge.json` in the Madang repository; a missing file is skipped silently. */
  updateNudgeFeed: true,
  /** First-launch telemetry consent banner (this build sends no telemetry). */
  telemetryBanner: false,
  /**
   * Phone pairing (Mobile page, sidebar button) and the Mobile Emulator tab. Hidden until Madang
   * has its own relay/mobile plan; the code stays so the feature can return by flipping this flag.
   */
  mobile: false,
  /** Help > "Explore Madang" feature tour (Orca's feature wall). The code stays; this hides the entry. */
  featureTour: false
} as const

export const MADANG_REPO_URL = 'https://github.com/Dawnilove/Madang'
export const MADANG_DOCS_URL = `${MADANG_REPO_URL}#readme`
export const MADANG_ISSUES_URL = `${MADANG_REPO_URL}/issues`
export const MADANG_NUDGE_URL =
  'https://raw.githubusercontent.com/Dawnilove/Madang/main/whats-new/nudge.json'

/** Madang convenience defaults: quieter first launch, fewer pop-ups. */
export const MADANG_UX = {
  /** Auto-open the feature tips modal at app start (still available from Help). */
  startupFeatureTips: false,
  /** "Configure usage tracking" call-to-action in the status bar before any provider is set up. */
  usageTrackingPrompt: false,
  /** One-time hints about Orca UI moves (e.g. "Workspace board moved to the bottom bar"). */
  upstreamChangeNotices: false,
  /** New profiles follow the OS language. Off: Madang starts new profiles in Korean. */
  systemUiLanguageDefault: false,
  /** New profiles show the Mobile button in the sidebar. Off: it stays hidden until enabled in Settings. */
  mobileButtonDefault: false,
  /**
   * New profiles start agents in Chat UI (structured chat) instead of a terminal. Madang is
   * chat-first; hosts that cannot run chat (SSH relay, WSL) still fall back to a terminal.
   */
  chatUiDefault: true,
  /**
   * Chat-centered shell: the left column lists projects > conversations (workspaces) instead of
   * Orca's workspace list. Off: Orca's original shell.
   */
  madangShell: true,
  /**
   * UI text uses the bundled rounded font NanumSquareRound instead of Orca's Geist while the font
   * setting is still the Orca default. A font the user picks in Settings always wins.
   */
  roundedUiFont: true
} as const

/** Font family registered in src/renderer/src/assets/adak-theme.css. */
export const MADANG_UI_FONT_FAMILY = 'NanumSquareRound'

export const MADANG_LOCAL = {
  /** Feedback and crash reports are saved on this PC and opened as a prefilled GitHub issue. */
  feedbackReports: true
} as const

/** Orca's own value of every MADANG_UX switch; e2e runs use these so upstream specs see the UI they were written for. */
export const ORCA_UX_DEFAULTS = {
  startupFeatureTips: true,
  usageTrackingPrompt: true,
  upstreamChangeNotices: true,
  systemUiLanguageDefault: true,
  mobileButtonDefault: true,
  chatUiDefault: false,
  madangShell: false,
  roundedUiFont: false
} as const satisfies Record<keyof typeof MADANG_UX, boolean>

export type MadangUx = { readonly [Key in keyof typeof MADANG_UX]: boolean }

export function resolveMadangUx(orcaDefaults: boolean): MadangUx {
  return orcaDefaults ? ORCA_UX_DEFAULTS : MADANG_UX
}

/** Main and preload read the e2e launch variable; the renderer gets the same answer from its e2e config. */
export function isOrcaDefaultsRequested(
  env: Readonly<Record<string, string | undefined>> | undefined = typeof process === 'undefined'
    ? undefined
    : process.env
): boolean {
  return env?.MADANG_E2E_ORCA_DEFAULTS === '1'
}

/** Feedback, crash-report and language-request UI shows while reports are saved locally. */
export const FEEDBACK_REPORTING_ENABLED: boolean = MADANG_LOCAL.feedbackReports
