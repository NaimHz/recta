import { describe, expect, it } from 'vitest'
import { loadCityConfig, loadVerificationFacts } from './facts'

describe('loadVerificationFacts', () => {
  it('assemble la ville et les faits curatés indexés par lieu OSM', async () => {
    const facts = await loadVerificationFacts('paris')

    expect(facts.city).toMatchObject({
      timezone: 'Europe/Paris',
      countryCode: 'FR',
      holidayRegion: 'Île-de-France',
    })
    expect(facts.city.center.lat).toBeCloseTo(48.8589, 3)
    expect(facts.city.center.lon).toBeCloseTo(2.347, 3)
    expect(facts.placeFacts['osm:relation/7515426']).toContainEqual({
      key: 'last_entry_before_close_minutes',
      value: 60,
      source: {
        provider: 'curated',
        url: 'https://www.louvre.fr/en/visit',
        sourceDate: '2026-11-03',
        retrievedAt: null,
      },
    })
    expect(facts.placeFacts['osm:way/55503397']?.[0]).toMatchObject({
      key: 'business_status',
      value: 'closed_temporarily',
    })
  })

  it('refuse un identifiant de ville qui sort du dossier des villes', async () => {
    await expect(loadCityConfig('../secrets')).rejects.toThrow(/Identifiant de ville invalide/)
  })
})
