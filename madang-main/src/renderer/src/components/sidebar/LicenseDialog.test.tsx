// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { LicenseDialog } from './LicenseDialog'

describe('LicenseDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the Orca MIT notice and the attribution line', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<LicenseDialog open onOpenChange={() => {}} />)
    })
    const text = document.body.textContent ?? ''
    expect(text).toContain('MIT License')
    expect(text).toContain('Lovecast Inc.')
    expect(text).toContain('built on the open-source Orca project')
    await act(async () => {
      root.unmount()
    })
  })
})
