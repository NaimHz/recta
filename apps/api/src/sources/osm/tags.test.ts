import { describe, expect, it } from 'vitest'
import type { OverpassElement } from '../overpass'
import { mapOsmElementToPlace } from './tags'

const retrievedAt = '2026-10-23T08:00:00.000Z'

describe('mapOsmElementToPlace', () => {
  it('maps a named node with address, category and source date', () => {
    const element: OverpassElement = {
      type: 'node',
      id: 101,
      lat: 48.8606,
      lon: 2.3376,
      tags: {
        name: 'Musée Exemple',
        tourism: 'museum',
        opening_hours: 'Mo-Su 09:00-18:00',
        check_date: '2026-09-01',
        'addr:housenumber': '1',
        'addr:street': 'Rue Exemple',
        'addr:postcode': '00000',
        'addr:city': 'Ville Exemple',
      },
    }

    const place = mapOsmElementToPlace(element, { retrievedAt })

    expect(place).toMatchObject({
      id: 'osm:node/101',
      name: 'Musée Exemple',
      coordinates: { lat: 48.8606, lon: 2.3376 },
      address: '1 Rue Exemple, 00000 Ville Exemple',
      category: 'tourism:museum',
      openingHoursRaw: 'Mo-Su 09:00-18:00',
      openingHours: null,
      source: {
        provider: 'osm',
        sourceDate: '2026-09-01',
        retrievedAt,
      },
    })
  })

  it('uses the center of a way and keeps a missing address null', () => {
    const element: OverpassElement = {
      type: 'way',
      id: 202,
      center: { lat: 48.8566, lon: 2.3522 },
      tags: {
        name: 'Café Exemple',
        amenity: 'cafe',
      },
    }

    expect(mapOsmElementToPlace(element, { retrievedAt })).toMatchObject({
      id: 'osm:way/202',
      coordinates: { lat: 48.8566, lon: 2.3522 },
      address: null,
      category: 'amenity:cafe',
      openingHoursRaw: null,
    })
  })

  it('returns null when the element has no name', () => {
    const element: OverpassElement = {
      type: 'node',
      id: 303,
      lat: 48.8,
      lon: 2.3,
      tags: { tourism: 'attraction' },
    }

    expect(mapOsmElementToPlace(element, { retrievedAt })).toBeNull()
  })

  it('keeps coordinates null and ignores an invalid source date', () => {
    const element: OverpassElement = {
      type: 'relation',
      id: 404,
      tags: {
        name: 'Marché Exemple',
        amenity: 'marketplace',
        'survey:date': '2026-09',
      },
    }

    expect(mapOsmElementToPlace(element, { retrievedAt })).toMatchObject({
      coordinates: null,
      source: {
        provider: 'osm',
        sourceDate: null,
        retrievedAt,
      },
    })
  })
})
