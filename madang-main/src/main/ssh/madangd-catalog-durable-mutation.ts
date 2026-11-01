import type { MadangdMigrationCatalogState } from '../../shared/madangd-migration/madangd-migration-manifest'

export async function resolveDurableMadangdCatalogMutation(
  mutate: () => Promise<MadangdMigrationCatalogState>,
  read: () => Promise<MadangdMigrationCatalogState>,
  accepted: (state: MadangdMigrationCatalogState) => boolean
) {
  try {
    return await mutate()
  } catch (mutationError) {
    let observed: MadangdMigrationCatalogState
    try {
      observed = await read()
    } catch {
      throw mutationError
    }
    if (!accepted(observed)) {
      throw mutationError
    }
  }
  // State reads may reflect unflushed mutations; an idempotent acknowledgment proves durability.
  return mutate()
}
