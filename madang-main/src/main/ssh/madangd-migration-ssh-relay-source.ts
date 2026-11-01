import { MADANGD_MIGRATION_SSH_RELAY_SOURCE_KIND } from '../../shared/madangd-migration/madangd-migration-source-kind'
import type { SshTarget } from '../../shared/ssh-types'
import { collectMadangdMigrationSourceCatalog } from '../persistence/migrating-madangd-catalog/madangd-source-catalog'
import type { Store } from '../persistence'
import { createMadangdMigrationManifest } from './madangd-migration-manifest-export'
import { IDENTITY_MADANGD_MIGRATION_PATH_REWRITER } from './madangd-migration-path-rewrite'
import type {
  MadangdMigrationSource,
  MadangdMigrationSourceCutoverPort
} from './madangd-migration-source'
import { assertMadangdMigrationSourceUnchanged } from './madangd-migration-source-assertions'
import {
  fenceMadangdMigrationSource,
  releaseMadangdMigrationFence,
  resolveMadangdMigrationFence
} from './madangd-migration-source-fence'
import {
  assessMadangdMigrationTerminals,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './madangd-migration-terminal-gate'
import type { SshTargetMadangdClaims } from './targets/ssh-target-madangd-claims'
import type { MadangdMigrationPreflightStore } from './targets/ssh-target-madangd-preflight'
import type { MadangdMigrationPaneLeasePredicate } from './madangd-migration-bridged-panes'

type SshRelayCutoverDeps = {
  userDataPath: string
  store: MadangdMigrationPreflightStore
  claims: SshTargetMadangdClaims
  /** Rebuild copied stores for every check so later edits remain visible. */
  freshSource?: () => MadangdMigrationPreflightStore
  signal?: AbortSignal
}

export function sshRelayMigrationCutoverPort(
  deps: SshRelayCutoverDeps
): MadangdMigrationSourceCutoverPort {
  return {
    verifyFence: (cutover) =>
      assertMadangdMigrationSourceUnchanged(
        { userDataPath: deps.userDataPath, store: deps.freshSource?.() ?? deps.store },
        cutover
      ),
    releaseFence: (cutover) => releaseMadangdMigrationFence(deps, cutover)
  }
}

export function createSshRelayMigrationSource(
  deps: SshRelayCutoverDeps & {
    store: MadangdMigrationPreflightStore &
      Pick<Store, 'getSshRemotePtyLeases' | 'markSshRemotePtyLease'>
    target: SshTarget
    /** Every relay endpoint on the host's account; without it exit can never be proven. */
    censusHost?: CensusHostRelayTerminals | null
    isBridgedPaneLease?: MadangdMigrationPaneLeasePredicate
  }
): MadangdMigrationSource {
  const { userDataPath, store, target } = deps
  return {
    ...sshRelayMigrationCutoverPort(deps),
    kind: MADANGD_MIGRATION_SSH_RELAY_SOURCE_KIND,
    journalKey: target.id,
    collectCatalog: () => collectMadangdMigrationSourceCatalog(store, target),
    exportManifest: (options = {}) =>
      createMadangdMigrationManifest(store, target, {
        ...options,
        rewrite: IDENTITY_MADANGD_MIGRATION_PATH_REWRITER
      }),
    assessTerminals: () => assessMadangdMigrationTerminals(store, target.id, deps.censusHost),
    retireProvenExitedTerminals: (proof) => retireProvenExitedLeases(store, target.id, proof),
    resolveFence: () => resolveMadangdMigrationFence(userDataPath, target),
    acquireFence: (args) =>
      fenceMadangdMigrationSource({
        userDataPath,
        store,
        claims: deps.claims,
        targetId: target.id,
        isBridgedPaneLease: deps.isBridgedPaneLease,
        ...args
      })
  }
}
