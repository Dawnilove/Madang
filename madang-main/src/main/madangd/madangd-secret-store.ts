// Always report available to prevent plaintext fallback; throw on seal/unseal when the key is unavailable.
import type { SecretStore } from '../../shared/secret-store'
import { sweepStaleRecordStaging } from './madangd-secret-key-record'
import {
  madangdSecretStatePath,
  resolveState,
  type MadangdSecretStorePrepareOptions,
  type StoreState
} from './madangd-secret-key-resolution'
import { openMadangdSecret, sealMadangdSecret } from './madangd-secret-sealing'

export type MadangdSecretStore = SecretStore & {
  prepare(options: MadangdSecretStorePrepareOptions): Promise<boolean>
}

export function createMadangdSecretStore(
  log: (message: string) => void = (message) => console.warn(message)
): MadangdSecretStore {
  let state: StoreState = { kind: 'pending' }
  const readyKey = (): Buffer => {
    if (state.kind === 'ready') {
      return state.key
    }
    throw new Error(
      state.kind === 'unavailable'
        ? state.message
        : 'madangd_secret_store_not_prepared — the headless secret store has not loaded its key yet'
    )
  }
  return {
    isEncryptionAvailable: () => state.kind !== 'plaintext',
    encryptString: (plainText) => sealMadangdSecret(readyKey(), plainText),
    decryptString: (cipher) => openMadangdSecret(readyKey(), cipher),
    describeProtectionGap: () => {
      switch (state.kind) {
        case 'ready':
          return state.gap
        case 'unavailable':
          return state.message
        case 'plaintext':
          return state.reason
        case 'pending':
          return "Madang's headless server has not loaded its credential key yet."
      }
    },
    async prepare(next) {
      sweepStaleRecordStaging(madangdSecretStatePath(next))
      state = await resolveState(next, log)
      return state.kind === 'ready'
    }
  }
}
