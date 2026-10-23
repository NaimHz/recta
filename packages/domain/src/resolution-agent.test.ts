import { describe, expect, it } from 'vitest'
import type { CityConfig } from './city'
import type { Place } from './plan'
import {
  runResolutionAgent,
  type PlaceSearchTool,
  type ResolutionSearchInput,
} from './resolution-agent'

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

function makePlace(
  id: string,
  name: string,
  category: string | null,
  lat = 48.8566,
  lon = 2.3522,
): Place {
  return {
    id,
    name,
    coordinates: { lat, lon },
    address: null,
    category,
    openingHoursRaw: null,
    openingHours: null,
    source: {
      provider: 'fixture',
      sourceDate: null,
      retrievedAt: null,
    },
  }
}

function makeTool(
  handler: (input: ResolutionSearchInput) => Place[] | Promise<Place[]>,
): PlaceSearchTool & { calls: ResolutionSearchInput[] } {
  const calls: ResolutionSearchInput[] = []

  return {
    name: 'fixture.search',
    calls,
    async search(input) {
      calls.push(input)

      return handler(input)
    },
  }
}

describe('runResolutionAgent', () => {
  it('résout un nom clair et journalise les appels', async () => {
    const tool = makeTool(() => [
      makePlace('osm:node/1', 'La Terrasse', 'amenity:restaurant'),
      makePlace('osm:node/2', 'La Crypte Polska', 'amenity:restaurant'),
    ])

    const result = await runResolutionAgent(
      { name: 'la terrasse', city, type: 'restaurant' },
      { search: tool },
    )

    expect(result.status).toBe('resolved')
    expect(result.place?.id).toBe('osm:node/1')
    expect(result.question).toBeNull()
    expect(result.options).toEqual([])
    expect(result.budget.maxCalls).toBe(6)
    expect(result.budget.usedCalls).toBe(2)
    expect(result.journal.some((entry) => entry.kind === 'decision')).toBe(true)
  })

  it('pose une question quand deux lieux ont le même nom', async () => {
    const tool = makeTool(() => [
      makePlace('osm:node/1', 'La Terrasse', 'amenity:cafe', 48.86, 2.35),
      makePlace('osm:node/2', 'La Terrasse', 'amenity:restaurant', 48.85, 2.34),
    ])

    const result = await runResolutionAgent({ name: 'la terrasse', city }, { search: tool })

    expect(result.status).toBe('needs_clarification')
    expect(result.place).toBeNull()
    expect(result.options.map((option) => option.id)).toEqual(['osm:node/1', 'osm:node/2'])
    expect(result.question).toMatch(/\?$/)
    expect(result.reason).toBe('close_scores')
    expect(result.journal.some((entry) => entry.kind === 'question')).toBe(true)
  })

  it('utilise le type pour départager deux lieux homonymes', async () => {
    const tool = makeTool(() => [
      makePlace('osm:node/1', 'Musée des Arts et Métiers', 'tourism:museum'),
      makePlace('osm:node/2', 'Les Arts et Métiers', 'amenity:cafe'),
    ])

    const result = await runResolutionAgent(
      { name: 'arts et metiers', city, type: 'museum' },
      { search: tool },
    )

    expect(result.status).toBe('resolved')
    expect(result.place?.id).toBe('osm:node/1')
  })

  it('ne devine pas un lieu à partir d’un mot générique', async () => {
    const tool = makeTool(() => [
      makePlace('osm:node/1', 'Café des Musées', 'amenity:restaurant'),
      makePlace('osm:node/2', 'Le Café Marly', 'amenity:cafe'),
    ])

    const result = await runResolutionAgent({ name: 'cafe', city }, { search: tool })

    expect(result.status).toBe('needs_clarification')
    expect(result.reason).toBe('generic_query')
    expect(result.options).toHaveLength(2)
  })

  it('ne fabrique pas de lieu quand aucun candidat plausible ne sort', async () => {
    const tool = makeTool(() => [makePlace('osm:node/1', 'Chez Denise', 'amenity:restaurant')])

    const result = await runResolutionAgent({ name: 'piscine pontoise', city }, { search: tool })

    expect(result.status).toBe('not_found')
    expect(result.place).toBeNull()
    expect(result.options).toEqual([])
    expect(result.question).toContain('préciser')
    expect(result.question).toMatch(/\?$/)
    expect(result.budget.usedCalls).toBe(2)
  })

  it('essaie une variante sans mot de type quand la première ne donne rien', async () => {
    const target = makePlace('osm:node/1', 'Restaurant de la Plaine', 'amenity:restaurant')
    const tool = makeTool((input) => (input.name === 'de la plaine' ? [target] : []))

    const result = await runResolutionAgent(
      { name: 'restaurant de la plaine', city },
      { search: tool },
    )

    expect(tool.calls.map((call) => call.name)).toEqual(['restaurant de la plaine', 'de la plaine'])
    expect(result.status).toBe('resolved')
    expect(result.place?.id).toBe('osm:node/1')
    expect(result.budget.usedCalls).toBe(3)
  })

  it('respecte le budget d’appels', async () => {
    const tool = makeTool(() => [makePlace('osm:node/1', 'Chez Denise', 'amenity:restaurant')])

    const result = await runResolutionAgent(
      { name: 'chez denise', city },
      { search: tool, maxCalls: 1 },
    )

    expect(result.status).toBe('not_found')
    expect(result.reason).toBe('budget_exhausted')
    expect(result.question).toContain("n'a pas abouti")
    expect(result.budget.usedCalls).toBe(1)
    expect(tool.calls).toHaveLength(1)
  })

  it('ne lève pas quand l’outil de recherche échoue', async () => {
    const tool = makeTool(() => {
      throw new Error('Nominatim indisponible')
    })

    const result = await runResolutionAgent({ name: 'chez denise', city }, { search: tool })

    expect(result.status).toBe('not_found')
    expect(result.reason).toBe('search_error')
    expect(result.question).toContain("n'a pas abouti")
    expect(result.question).toMatch(/\?$/)
    expect(
      result.journal.some(
        (entry) => entry.kind === 'tool' && entry.tool === 'search' && entry.status === 'error',
      ),
    ).toBe(true)
  })
})
