/// Bundle ids of the apps whose computer-use sidecar may drive this helper.
public enum TrustedOrcaApplication {
    public static func isTrusted(bundleId: String) -> Bool {
        // Why: `pnpm dev` launches as `io.github.dawnilove.madang.dev` and per-worktree wrapper apps use
        // `io.github.dawnilove.madang.dev.<name>`; the sidecar peer check must authorize both (#26498).
        bundleId == "io.github.dawnilove.madang" ||
            bundleId == "io.github.dawnilove.madang.dev" ||
            bundleId.hasPrefix("io.github.dawnilove.madang.dev.") ||
            bundleId == "com.github.Electron"
    }
}
