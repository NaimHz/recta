import { describe, expect, it } from 'vitest'
import { CityConfigSchema } from './city'

const validCity = {
  id: 'test-city',
  name: 'Test City',
  bbox: [-1, -1, 1, 1] as [number, number, number, number],
  timezone: 'Europe/Paris',
  country: 'FR',
  holidayRegion: 'Test Region',
  transitAreaIds: [],
  locale: 'fr-FR',
  curatedFactsPath: 'data/curated.yml',
  evalCorpusPath: 'evals/corpus',
  capabilities: {
    transit: false,
    curatedFacts: false,
  },
}

describe('CityConfigSchema', () => {
  it('accepts a valid city config', () => {
    expect(CityConfigSchema.parse(validCity)).toEqual(validCity)
  })

  it('rejects a bbox with inverted bounds', () => {
    expect(() => CityConfigSchema.parse({ ...validCity, bbox: [1, 1, -1, -1] })).toThrow()
  })
})
