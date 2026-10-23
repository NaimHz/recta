import { describe, expect, it } from 'vitest'
import { CuratedFactsFileSchema } from './curated-facts'

const validFile = {
  version: 1,
  city: 'paris',
  sites: [
    {
      id: 'louvre',
      name: 'Musée du Louvre',
      placeId: 'osm:relation/7515426',
      address: 'Place du Carrousel, 75001 Paris',
      facts: [
        {
          key: 'business_status',
          value: 'operational',
          source: {
            url: 'https://www.louvre.fr/en/visit',
            reviewedAt: '2026-10-23',
          },
        },
      ],
    },
  ],
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('CuratedFactsFileSchema', () => {
  it('accepte une base curatée valide', () => {
    expect(CuratedFactsFileSchema.parse(validFile)).toEqual(validFile)
  })

  it('refuse un fait sans source', () => {
    const file = clone(validFile)
    delete (file.sites[0]!.facts[0] as { source?: unknown }).source

    expect(() => CuratedFactsFileSchema.parse(file)).toThrow()
  })

  it('refuse une source sans date de revue', () => {
    const file = clone(validFile)
    delete (file.sites[0]!.facts[0]!.source as { reviewedAt?: string }).reviewedAt

    expect(() => CuratedFactsFileSchema.parse(file)).toThrow()
  })

  it('refuse un statut inconnu', () => {
    const file = clone(validFile)
    file.sites[0]!.facts[0]!.value = 'open'

    expect(() => CuratedFactsFileSchema.parse(file)).toThrow()
  })

  it('refuse une source non HTTPS', () => {
    const file = clone(validFile)
    file.sites[0]!.facts[0]!.source.url = 'http://www.louvre.fr/en/visit'

    expect(() => CuratedFactsFileSchema.parse(file)).toThrow()
  })

  it('refuse deux sites avec le même identifiant', () => {
    const file = clone(validFile)
    file.sites.push(clone(file.sites[0]!))

    expect(() => CuratedFactsFileSchema.parse(file)).toThrow()
  })

  it('refuse deux sites liés au même lieu OSM', () => {
    const duplicate = clone(validFile.sites[0]!)
    duplicate.id = 'louvre-bis'
    const file = clone(validFile)
    file.sites.push(duplicate)

    expect(() => CuratedFactsFileSchema.parse(file)).toThrow()
  })

  it('refuse deux fois le même fait pour un site', () => {
    const file = clone(validFile)
    file.sites[0]!.facts.push(clone(file.sites[0]!.facts[0]!))

    expect(() => CuratedFactsFileSchema.parse(file)).toThrow()
  })
})
