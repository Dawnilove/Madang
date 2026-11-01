import { describe, expect, it } from 'vitest'
import { getContextualTour, normalizeContextualTourIds } from '../../../../shared/contextual-tours'
import en from '../../i18n/locales/en.json'
import ko from '../../i18n/locales/ko.json'

type Catalog = { madang: { tour: Record<string, unknown> } }

describe('madang-intro tour', () => {
  const tour = getContextualTour('madang-intro')

  it('has eight uniquely named steps and a start step', () => {
    const ids = tour.steps.map((step) => step.id)
    expect(ids).toHaveLength(8)
    expect(new Set(ids).size).toBe(8)
    expect(tour.steps.filter((step) => step.requiredForStart)).toHaveLength(1)
    expect(tour.steps[0]?.requiredForStart).toBe(true)
  })

  it('keeps its id when persisted ids are read back', () => {
    expect(normalizeContextualTourIds(['madang-intro', 'unknown'])).toEqual(['madang-intro'])
  })

  it.each([
    ['en', en as unknown as Catalog],
    ['ko', ko as unknown as Catalog]
  ])('has title and body in the %s catalog for every step', (_name, catalog) => {
    for (const step of tour.steps) {
      const name = step.id!.replace('madang-intro-', '')
      const copy = catalog.madang.tour[name] as { title?: string; body?: string } | undefined
      expect(copy?.title, name).toBeTruthy()
      expect(copy?.body, name).toBeTruthy()
    }
    expect(catalog.madang.tour.menuItem).toBeTruthy()
  })
})
