import { randomUUID } from 'node:crypto'
import type { SkillCloudVersion } from '../../shared/skill-cloud-contract'

const TTL_MS = 30 * 60 * 1000
const MAX_STAGED = 8

export type StagedSkillImport = {
  archivePath: string
  version: SkillCloudVersion
  cleanup(): Promise<void>
  expiresAt: number
}

/**
 * Holds bundles the user chose or fetched, until installed or closed. The renderer only ever holds
 * the id: the archive path stays in the main process, so a path the user did not pick is never trusted.
 */
export class SkillImportRegistry {
  private readonly staged = new Map<string, StagedSkillImport>()

  async stage(input: Omit<StagedSkillImport, 'expiresAt'>): Promise<string> {
    await this.prune()
    while (this.staged.size >= MAX_STAGED) {
      const oldest = this.staged.keys().next().value as string
      await this.release(oldest)
    }
    const id = randomUUID()
    this.staged.set(id, { ...input, expiresAt: Date.now() + TTL_MS })
    return id
  }

  get(id: string): StagedSkillImport | null {
    const value = this.staged.get(id)
    return value && value.expiresAt > Date.now() ? value : null
  }

  async release(id: string): Promise<void> {
    const value = this.staged.get(id)
    this.staged.delete(id)
    await value?.cleanup().catch(() => undefined)
  }

  async releaseAll(): Promise<void> {
    await Promise.all([...this.staged.keys()].map((id) => this.release(id)))
  }

  private async prune(): Promise<void> {
    const now = Date.now()
    await Promise.all(
      [...this.staged].filter(([, value]) => value.expiresAt <= now).map(([id]) => this.release(id))
    )
  }
}
