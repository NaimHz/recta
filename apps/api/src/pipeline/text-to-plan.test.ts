import { describe, expect, it } from 'vitest'
import {
  NO_TRAVEL,
  verifyPlan,
  type CityConfig,
  type Place,
  type PlaceSearchTool,
} from '@recta/domain'
import type { OverpassElement, OverpassResult } from '../sources/overpass'
import { loadCityConfig, loadVerificationFacts } from '../verification/facts'
import { CityMismatchError, buildPlanFromText } from './text-to-plan'

const TEXT = [
  'Samedi 24 octobre à Paris',
  '10h-12h Musée Rodin',
  '18h-20h Galerie Vivienne',
  '20h30 dîner au Café Lumière',
  '22h Bar Inconnu',
].join('\n')

const EXTRACTION = {
  days: [
    {
      dateText: 'Samedi 24 octobre',
      city: 'Paris',
      timezoneText: null,
      stops: [
        {
          name: 'Musée Rodin',
          startText: '10h',
          endText: '12h',
          type: null,
          sourceText: '10h-12h Musée Rodin',
        },
        {
          name: 'Galerie Vivienne',
          startText: '18h',
          endText: '20h',
          type: null,
          sourceText: '18h-20h Galerie Vivienne',
        },
        {
          name: 'Café Lumière',
          startText: '20h30',
          endText: null,
          type: 'dîner',
          sourceText: '20h30 dîner au Café Lumière',
        },
        {
          name: 'Bar Inconnu',
          startText: '22h',
          endText: null,
          type: null,
          sourceText: '22h Bar Inconnu',
        },
      ],
    },
  ],
}

function place(id: string, name: string, lat: number, lon: number): Place {
  return {
    id,
    name,
    coordinates: { lat, lon },
    address: null,
    category: null,
    openingHoursRaw: null,
    source: { provider: 'osm', sourceDate: null, retrievedAt: '2026-11-03T12:00:00.000Z' },
  }
}

const PLACES: Record<string, Place[]> = {
  'Musée Rodin': [place('osm:way/1001', 'Musée Rodin', 48.8553, 2.3158)],
  'Galerie Vivienne': [place('osm:node/1002', 'Galerie Vivienne', 48.8665, 2.3399)],
  'Café Lumière': [
    place('osm:node/1003', 'Café Lumière', 48.85, 2.35),
    place('osm:node/1004', 'Café Lumière', 48.88, 2.3),
  ],
}

const search: PlaceSearchTool = {
  name: 'fake.search',
  search: async ({ name }) => PLACES[name] ?? [],
}

const ELEMENTS: OverpassElement[] = [
  {
    type: 'way',
    id: 1001,
    center: { lat: 48.8553, lon: 2.3158 },
    tags: {
      name: 'Musée Rodin',
      tourism: 'museum',
      opening_hours: 'Tu-Su 10:30-18:30; Mo off',
      check_date: '2026-06-01',
    },
  },
  {
    type: 'node',
    id: 1002,
    lat: 48.8665,
    lon: 2.3399,
    tags: { name: 'Galerie Vivienne', opening_hours: 'Mo-Su 08:30-20:30' },
  },
]

function overpass(elements: OverpassElement[] | Error) {
  const queries: string[] = []

  return {
    queries,
    client: {
      query: async (query: string): Promise<OverpassResult> => {
        queries.push(query)

        if (elements instanceof Error) throw elements

        return { elements, endpoint: 'fake', osmBaseTimestamp: '2026-11-03T00:00:00Z' }
      },
    },
  }
}

async function build(
  overrides: {
    text?: string
    extraction?: unknown
    elements?: OverpassElement[] | Error
    city?: CityConfig
  } = {},
) {
  const city = overrides.city ?? (await loadCityConfig('paris'))
  const fakeOverpass = overpass(overrides.elements ?? ELEMENTS)
  const result = await buildPlanFromText(
    overrides.text ?? TEXT,
    { city, start: null, today: '2026-10-20' },
    {
      extraction: { extract: async () => overrides.extraction ?? EXTRACTION },
      search,
      overpass: fakeOverpass.client,
      now: () => '2026-11-03T12:00:00.000Z',
    },
  )

  return { ...result, queries: fakeOverpass.queries }
}

describe('buildPlanFromText', () => {
  it('assemble un plan daté, résolu et enrichi des horaires OSM', async () => {
    const { plan, queries } = await build()
    const [day] = plan.days

    expect(plan.cityId).toBe('paris')
    expect(day).toMatchObject({ id: 'day-1', date: '2026-10-24', timezone: 'Europe/Paris' })
    expect(
      day?.stops.map((stop) => [stop.id, stop.resolution, stop.start, stop.windowSource]),
    ).toEqual([
      ['stop-1', 'resolved', '10:00', 'explicit'],
      ['stop-2', 'resolved', '18:00', 'explicit'],
      ['stop-3', 'ambiguous', '20:30', 'default_duration'],
      ['stop-4', 'not_found', '22:00', 'default_duration'],
    ])
    expect(day?.stops[0]?.place).toMatchObject({
      id: 'osm:way/1001',
      openingHoursRaw: 'Tu-Su 10:30-18:30; Mo off',
      source: { provider: 'osm', sourceDate: '2026-06-01' },
    })
    expect(queries).toEqual([
      '[out:json][timeout:25];\n(\nnode(id:1002);\nway(id:1001);\n);\nout tags center;',
    ])
  })

  it('rend la question et les options d’un lieu ambigu ou introuvable', async () => {
    const { resolutions } = await build()

    expect(resolutions.map((entry) => [entry.stopId, entry.status])).toEqual([
      ['stop-1', 'resolved'],
      ['stop-2', 'resolved'],
      ['stop-3', 'ambiguous'],
      ['stop-4', 'not_found'],
    ])
    expect(resolutions[2]?.options.map((option) => option.id)).toEqual([
      'osm:node/1003',
      'osm:node/1004',
    ])
    expect(resolutions[2]?.question).toEqual(expect.stringContaining('Café Lumière'))
    expect(resolutions[3]?.question).toEqual(expect.stringContaining('Bar Inconnu'))
  })

  it('garde le lieu Nominatim sans horaires quand Overpass ne répond pas', async () => {
    const { plan } = await build({ elements: new Error('Overpass indisponible') })

    expect(plan.days[0]?.stops[0]?.place).toMatchObject({
      id: 'osm:way/1001',
      openingHoursRaw: null,
    })
  })

  it('refuse un texte écrit pour une autre ville', async () => {
    const extraction = { days: [{ ...EXTRACTION.days[0], city: 'Lyon' }] }

    await expect(build({ text: TEXT.replace('à Paris', 'à Lyon'), extraction })).rejects.toThrow(
      CityMismatchError,
    )
  })

  it('produit une issue prouvée sur le plan assemblé', async () => {
    const { plan } = await build()
    const facts = await loadVerificationFacts('paris')
    const result = verifyPlan(plan, { ...facts, travel: NO_TRAVEL })

    expect(result.issues.map((issue) => [issue.code, issue.stopIds])).toEqual([
      ['outside_opening_hours', ['stop-1']],
    ])
  })
})
