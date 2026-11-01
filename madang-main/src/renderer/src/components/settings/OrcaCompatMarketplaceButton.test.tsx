// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCA_COMPAT_MARKETPLACE_GIT_SOURCE } from '../../../../shared/plugins/orca-compat'
import { OrcaCompatMarketplaceButton } from './OrcaCompatMarketplaceButton'

const addMarketplace = vi.fn()

beforeEach(() => {
  addMarketplace.mockReset().mockResolvedValue({})
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { plugins: { addMarketplace } }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(onAdded: () => Promise<void>): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(<OrcaCompatMarketplaceButton onAdded={onAdded} />)
  })
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === text
  )
  if (!found) {
    throw new Error(`missing button: ${text}`)
  }
  return found
}

describe('OrcaCompatMarketplaceButton', () => {
  it('contacts nothing until the user confirms the warning', async () => {
    const onAdded = vi.fn().mockResolvedValue(undefined)
    await mount(onAdded)
    expect(addMarketplace).not.toHaveBeenCalled()

    await act(async () => buttonByText('Add Orca-compatible plugins').click())
    expect(document.body.textContent).toContain('third-party plugins made for Orca')
    expect(addMarketplace).not.toHaveBeenCalled()

    await act(async () => buttonByText('Add').click())
    expect(addMarketplace).toHaveBeenCalledWith(ORCA_COMPAT_MARKETPLACE_GIT_SOURCE)
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it('shows an error and keeps the dialog open when adding fails', async () => {
    addMarketplace.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const onAdded = vi.fn().mockResolvedValue(undefined)
    await mount(onAdded)

    await act(async () => buttonByText('Add Orca-compatible plugins').click())
    await act(async () => buttonByText('Add').click())

    expect(document.body.textContent).toContain('Could not add the Orca-compatible plugins')
    expect(onAdded).not.toHaveBeenCalled()
  })
})
