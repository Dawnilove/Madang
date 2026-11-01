import { vi } from 'vitest'

// Main-owned layout variant: registration must publish once without waiting for a later frame.
vi.mock('../../shared/layout-owner-switch', () => ({ MADANG_LAYOUT_OWNER_IS_MAIN: true }))

await import('./madang-runtime-cold-restore-terminal-membership.test')
