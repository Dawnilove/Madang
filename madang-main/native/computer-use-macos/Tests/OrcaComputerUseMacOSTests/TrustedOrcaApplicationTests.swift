import Testing
@testable import OrcaComputerUseMacOSCore

@Suite("TrustedOrcaApplication")
struct TrustedOrcaApplicationTests {
    @Test("trusts the packaged app, every dev build and stock Electron")
    func trusted() {
        #expect(TrustedOrcaApplication.isTrusted(bundleId: "io.github.dawnilove.madang"))
        // What `pnpm dev` launches as: DEV_BUNDLE_ID in dev-electron-bundle-identity.mjs (#26498).
        #expect(TrustedOrcaApplication.isTrusted(bundleId: "io.github.dawnilove.madang.dev"))
        #expect(TrustedOrcaApplication.isTrusted(bundleId: "io.github.dawnilove.madang.dev.worktree"))
        #expect(TrustedOrcaApplication.isTrusted(bundleId: "com.github.Electron"))
    }

    @Test("rejects look-alike and unrelated bundle ids")
    func untrusted() {
        #expect(!TrustedOrcaApplication.isTrusted(bundleId: "io.github.dawnilove.madang.devtools"))
        #expect(!TrustedOrcaApplication.isTrusted(bundleId: "io.github.dawnilove.madangx"))
        #expect(!TrustedOrcaApplication.isTrusted(bundleId: "com.example.orca"))
        #expect(!TrustedOrcaApplication.isTrusted(bundleId: ""))
    }
}
