import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CityConfigSchema, type Place } from '@recta/domain'
import { NominatimClient, type NominatimSearchResult } from '../nominatim'
import { OverpassClient } from '../overpass'
import { buildPoiQuery } from './query'
import { mapOsmElementToPlace } from './tags'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const citiesDirectory = join(repoRoot, 'packages', 'data', 'cities')
const outputDirectory = join(repoRoot, 'evals', 'sources')
const outputPath = join(outputDirectory, 'osm-places.json')

const targetPerCity = 25
const queryLimit = 80

type CityResult = {
  id: string
  name: string
  placeCount: number
  geocoded: {
    displayName: string
    lat: number
    lon: number
  } | null
  source: {
    endpoint: string
    osmBaseTimestamp: string | null
    elements: number
  }
  places: Place[]
}

async function readCityConfigs() {
  const entries = await readdir(citiesDirectory, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
  const cities = []

  for (const directory of directories) {
    const path = join(citiesDirectory, directory.name, 'city.json')
    const config = CityConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))

    cities.push(config)
  }

  return cities
}

function geocodedSummary(result: NominatimSearchResult | undefined): CityResult['geocoded'] {
  if (!result) return null

  return {
    displayName: result.displayName,
    lat: result.lat,
    lon: result.lon,
  }
}

async function main(): Promise<void> {
  const retrievedAt = new Date().toISOString()
  const withNominatim = process.argv.includes('--nominatim')
  const overpass = new OverpassClient({ minIntervalMs: 1_000 })
  const nominatim = withNominatim ? new NominatimClient() : null
  const cities = await readCityConfigs()

  if (cities.length === 0) {
    throw new Error('Aucun pack ville trouvé.')
  }

  const results: CityResult[] = []

  for (const city of cities) {
    console.log(`Overpass : ${city.name}.`)
    const response = await overpass.query(buildPoiQuery(city.bbox, queryLimit))
    const unique = new Map<string, Place>()

    for (const element of response.elements) {
      const place = mapOsmElementToPlace(element, { retrievedAt })

      if (place?.coordinates) {
        unique.set(place.id, place)
      }
    }

    const places = [...unique.values()].slice(0, targetPerCity)

    if (places.length < targetPerCity) {
      throw new Error(
        `${city.name} : ${places.length} lieux avec coordonnées, ${targetPerCity} attendus.`,
      )
    }

    let geocoded: CityResult['geocoded'] = null

    if (nominatim) {
      console.log(`Nominatim : ${city.name}.`)
      const matches = await nominatim.search({
        query: city.name,
        countryCode: city.country,
        limit: 1,
      })
      geocoded = geocodedSummary(matches[0])
    }

    results.push({
      id: city.id,
      name: city.name,
      placeCount: places.length,
      geocoded,
      source: {
        endpoint: response.endpoint,
        osmBaseTimestamp: response.osmBaseTimestamp,
        elements: response.elements.length,
      },
      places,
    })
  }

  const totalPlaces = results.reduce((total, city) => total + city.placeCount, 0)

  if (totalPlaces !== 50) {
    throw new Error(`${totalPlaces} lieux récupérés, 50 attendus.`)
  }

  const output = {
    version: 1,
    retrievedAt,
    targetPerCity,
    totalPlaces,
    calls: {
      overpass: results.length,
      nominatim: withNominatim ? results.length : 0,
    },
    limits: {
      overpassMinIntervalMs: 1_000,
      nominatimMinIntervalMs: 1_100,
    },
    attribution: 'OpenStreetMap contributors',
    license: 'ODbL-1.0',
    cities: results,
  }

  await mkdir(outputDirectory, { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`${totalPlaces} lieux écrits dans ${outputPath}.`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
