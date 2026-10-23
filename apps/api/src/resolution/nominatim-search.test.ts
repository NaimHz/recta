import { describe, expect, it } from 'vitest'
import type { CityConfig } from '@recta/domain'
import { NominatimPlaceSearch, type NominatimSearchClient } from './nominatim-search'
import type { NominatimSearchParams } from '../sources/nominatim'

const city: CityConfig = {
  id: 'paris',
  name: 'Paris',
  bbox: [2.2241, 48.8156, 2.4699, 48.9022],
  timezone: 'Europe/Paris',
  country: 'FR',
  holidayRegion: 'Île-de-France',
  transitAreaIds: [],
  locale: 'fr-FR',
  curatedFactsPath: 'curated.yml',
  evalCorpusPath: 'evals/corpus/paris',
  capabilities: { transit: false, curatedFacts: false },
}

describe('NominatimPlaceSearch', () => {
  it('mappe les résultats et écarte ceux hors de la ville', async () => {
    let received: NominatimSearchParams | undefined
    const client: NominatimSearchClient = {
      async search(params) {
        received = params

        return [
          {
            placeId: 10,
            osmType: 'node',
            osmId: 123,
            displayName: 'La Terrasse, Paris, France',
            lat: 48.8566,
            lon: 2.3522,
            category: 'amenity',
            type: 'cafe',
            address: { city: 'Paris' },
          },
          {
            placeId: 11,
            osmType: 'node',
            osmId: 456,
            displayName: 'La Terrasse, Lyon, France',
            lat: 45.76,
            lon: 4.83,
            category: 'amenity',
            type: 'cafe',
            address: { city: 'Lyon' },
          },
        ]
      },
    }
    const tool = new NominatimPlaceSearch({
      client,
      now: () => '2026-10-23T10:00:00.000Z',
    })

    const places = await tool.search({ name: 'La Terrasse', city })

    expect(received).toEqual({
      query: 'La Terrasse, Paris',
      countryCode: 'FR',
      limit: 8,
    })
    expect(places).toHaveLength(1)
    expect(places[0]).toMatchObject({
      id: 'osm:node/123',
      name: 'La Terrasse',
      address: 'La Terrasse, Paris, France',
      category: 'amenity:cafe',
      source: {
        provider: 'osm',
        sourceDate: null,
        retrievedAt: '2026-10-23T10:00:00.000Z',
      },
    })
  })

  it('utilise place_id quand les identifiants OSM manquent', async () => {
    const client: NominatimSearchClient = {
      async search() {
        return [
          {
            placeId: 456,
            osmType: null,
            osmId: null,
            displayName: 'Lieu sans OSM, Paris, France',
            lat: 48.8566,
            lon: 2.3522,
            category: 'tourism',
            type: 'museum',
            address: null,
          },
        ]
      },
    }
    const tool = new NominatimPlaceSearch({ client })

    const places = await tool.search({ name: 'Lieu sans OSM', city })

    expect(places[0]?.id).toBe('nominatim:456')
  })

  it('ignore un résultat sans nom', async () => {
    const client: NominatimSearchClient = {
      async search() {
        return [
          {
            placeId: 789,
            osmType: 'node',
            osmId: 789,
            displayName: '',
            lat: 48.8566,
            lon: 2.3522,
            category: null,
            type: null,
            address: null,
          },
        ]
      },
    }
    const tool = new NominatimPlaceSearch({ client })

    await expect(tool.search({ name: 'Sans nom', city })).resolves.toEqual([])
  })
})
