import { vi } from 'vitest'

// Run the pane-close no-widening contract under main-owned layout.
vi.mock('../../shared/layout-owner-switch', () => ({ MADANG_LAYOUT_OWNER_IS_MAIN: true }))

await import('./madang-runtime-terminal-close-no-widening.test')
