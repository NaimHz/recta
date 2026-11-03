import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CityConfigSchema,
  NO_TRAVEL,
  type CityConfig,
  type CuratedFactsFile,
  type PlaceFact,
  type VerificationFacts,
} from '@recta/domain'
import { loadCuratedFacts } from '../sources/curated/facts'

const defaultRepoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const CITY_ID = /^[a-z0-9-]+$/

export async function loadCityConfig(
  cityId: string,
  repoRoot = defaultRepoRoot,
): Promise<CityConfig> {
  if (!CITY_ID.test(cityId)) {
    throw new Error(`Identifiant de ville invalide : ${cityId}`)
  }

  const path = resolve(repoRoot, 'packages/data/cities', cityId, 'city.json')

  return CityConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

export function toPlaceFacts(file: CuratedFactsFile): Record<string, PlaceFact[]> {
  const placeFacts: Record<string, PlaceFact[]> = {}

  for (const site of file.sites) {
    if (site.placeId === null) continue

    placeFacts[site.placeId] = site.facts.map((fact) => ({
      ...fact,
      source: {
        provider: 'curated',
        url: fact.source.url,
        sourceDate: fact.source.reviewedAt,
        retrievedAt: null,
      },
    }))
  }

  return placeFacts
}

export function cityFacts(city: CityConfig): VerificationFacts['city'] {
  const [west, south, east, north] = city.bbox

  return {
    timezone: city.timezone,
    countryCode: city.country,
    holidayRegion: city.holidayRegion,
    center: { lat: (south + north) / 2, lon: (west + east) / 2 },
  }
}

export async function loadVerificationFacts(
  cityId: string,
  repoRoot = defaultRepoRoot,
): Promise<VerificationFacts> {
  const city = await loadCityConfig(cityId, repoRoot)
  const curated = city.capabilities.curatedFacts ? await loadCuratedFacts(city, repoRoot) : null

  return {
    city: cityFacts(city),
    placeFacts: curated ? toPlaceFacts(curated) : {},
    travel: NO_TRAVEL,
  }
}
