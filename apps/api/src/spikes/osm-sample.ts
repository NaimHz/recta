import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CityConfigSchema } from '@recta/domain'
import {
  queryOverpass,
  userAgent,
  type OverpassElement,
  type OverpassElementType,
  type OverpassResult,
} from './overpass'

const strata = ['museums_attractions', 'restaurants_cafes', 'shops_markets'] as const
type Stratum = (typeof strata)[number]

const seed = 20261022
const randomFilters: Record<Stratum, string[]> = {
  museums_attractions: [
    '["tourism"~"museum|attraction|gallery|zoo|theme_park"]',
    '["historic"~"castle|fort"]',
  ],
  restaurants_cafes: ['["amenity"~"restaurant|cafe"]'],
  shops_markets: [
    '["shop"~"bakery|butcher|cheese|greengrocer|supermarket|convenience|clothes|books|gift|department_store|mall"]',
    '["amenity"="marketplace"]',
  ],
}
const iconicFilters = [
  '["tourism"~"museum|attraction|gallery|viewpoint|zoo|theme_park|artwork"]',
  '["historic"]',
  '["amenity"~"marketplace|theatre|arts_centre"]',
  '["amenity"="place_of_worship"]',
  '["leisure"~"park|garden"]',
]

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const spikesDirectory = join(repoRoot, 'evals', 'spikes')
const cityConfigsDirectory = join(spikesDirectory, 'cities')
const referenceCitiesDirectory = join(repoRoot, 'packages', 'data', 'cities')

type Evaluation = {
  dates: string[]
  sunday: string
  holiday: string | null
}

type CityInput = {
  id: string
  name: string
  timezone: string
  country: string
  countryCode: string
  holidayState?: string
  bbox: [number, number, number, number]
  adminArea?: string
  adminLevel?: string
  evaluation: Evaluation
}

type IconicInput = {
  name: string
  aliases: string[]
  stratum: Stratum
}

type CityProtocol = {
  city: CityInput
  seed: number
  randomPerStratum: number
  iconic: IconicInput[]
}

type SamplePlace = {
  kind: 'iconic' | 'random'
  name: string
  stratum: Stratum
  osm: {
    type: OverpassElementType
    id: number
  }
}

type SourceInfo = {
  endpoint: string
  osmBaseTimestamp: string | null
}

type BoundaryInfo = {
  provider: 'Nominatim'
  placeId: number | null
  displayName: string | null
}

type SampleFile = {
  version: 1
  protocol: 'ADR-002' | 'calibration'
  createdAt: string
  city: CityInput & {
    selectionArea: 'administrative polygon' | 'bbox'
    boundary: BoundaryInfo | null
  }
  seed: number
  randomPerStratum: number
  strata: Stratum[]
  candidateCounts: Record<Stratum, number>
  places: SamplePlace[]
  sources: SourceInfo[]
  attribution: 'OpenStreetMap contributors'
  license: 'ODbL-1.0'
}

type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

type NominatimFeature = {
  properties?: {
    place_id?: number
    osm_id?: number
    display_name?: string
  }
  geometry?: GeoJsonGeometry
}

type NominatimResponse = {
  features?: NominatimFeature[]
}

const defaultEvaluation: Evaluation = {
  dates: [
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
  ],
  sunday: '2026-09-13',
  holiday: null,
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function bboxScope(city: CityInput): string {
  const [west, south, east, north] = city.bbox
  return `(${south},${west},${north},${east})`
}

async function queryPool(
  city: CityInput,
  filters: string[],
  withTags: boolean,
): Promise<OverpassResult> {
  const scope = bboxScope(city)
  const statements = filters.map((filter) => `nwr${scope}${filter}["name"];`).join('\n')
  const output = withTags ? 'tags center' : 'ids center'
  const query = `[out:json][timeout:180];\n(\n${statements}\n);\nout ${output};`

  return queryOverpass(query)
}

async function fetchElements(elements: OverpassElement[]): Promise<OverpassResult> {
  const statements = dedupe(elements)
    .map((element) => `${element.type}(${element.id});`)
    .join('\n')
  const query = `[out:json][timeout:120];\n(\n${statements}\n);\nout tags center;`

  return queryOverpass(query)
}

function elementKey(element: OverpassElement): string {
  return `${element.type}/${element.id}`
}

function dedupe(elements: OverpassElement[]): OverpassElement[] {
  const byKey = new Map<string, OverpassElement>()

  for (const element of elements) {
    byKey.set(elementKey(element), element)
  }

  return [...byKey.values()]
}

const typeRank: Record<OverpassElementType, number> = {
  relation: 0,
  way: 1,
  node: 2,
}

function compareElements(left: OverpassElement, right: OverpassElement): number {
  return typeRank[left.type] - typeRank[right.type] || left.id - right.id
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function candidateScore(element: OverpassElement, exact: boolean): number {
  let score = exact ? 100 : 0

  if (element.tags?.wikidata) score += 20
  if (element.tags?.wikipedia) score += 10
  if (element.tags?.tourism === 'attraction') score += 8
  if (element.tags?.tourism === 'museum') score += 6
  if (element.tags?.historic) score += 4
  if (element.tags?.amenity === 'theatre') score += 4
  if (element.tags?.amenity === 'marketplace') score += 4
  if (element.type === 'way' || element.type === 'relation') score += 3

  return score
}

function resolveIconic(iconic: IconicInput, pool: OverpassElement[]): OverpassElement {
  const targets = [iconic.name, ...iconic.aliases].map(normalize)
  const candidates = pool
    .filter((element) => element.tags?.name)
    .map((element) => {
      const name = normalize(element.tags?.name ?? '')
      const exact = targets.includes(name)
      const included = targets.some((target) => name.includes(target))

      return {
        element,
        exact,
        included,
        score: candidateScore(element, exact),
      }
    })
    .filter((candidate) => candidate.exact || candidate.included)
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareElements(left.element, right.element) ||
        left.element.id - right.element.id,
    )

  const best = candidates[0]

  if (!best) {
    const examples = pool
      .filter((element) => element.tags?.name)
      .slice(0, 15)
      .map((element) => element.tags?.name)
      .filter(Boolean)
      .join(', ')

    throw new Error(`Lieu introuvable : ${iconic.name}. Exemples : ${examples}`)
  }

  return best.element
}

function elementPoint(element: OverpassElement): [number, number] | null {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return [element.lon, element.lat]
  }

  if (element.center) {
    return [element.center.lon, element.center.lat]
  }

  return null
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  if (ring.length < 3) return false

  let inside = false

  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const currentPoint = ring[index]
    const previousPoint = ring[previous]

    if (!currentPoint || !previousPoint) continue

    const [currentX, currentY] = currentPoint
    const [previousX, previousY] = previousPoint

    if (currentX === undefined || currentY === undefined) continue
    if (previousX === undefined || previousY === undefined) continue

    const intersects =
      currentY > point[1] !== previousY > point[1] &&
      point[0] <
        ((previousX - currentX) * (point[1] - currentY)) / (previousY - currentY) + currentX

    if (intersects) inside = !inside
  }

  return inside
}

function pointInPolygon(point: [number, number], polygon: number[][][]): boolean {
  const outer = polygon[0]

  if (!outer || !pointInRing(point, outer)) return false

  return !polygon.slice(1).some((hole) => pointInRing(point, hole))
}

function pointInGeometry(point: [number, number], geometry: GeoJsonGeometry): boolean {
  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates)
  }

  return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon))
}

async function fetchAdministrativePolygon(city: CityInput): Promise<{
  geometry: GeoJsonGeometry
  boundary: BoundaryInfo
} | null> {
  if (!city.adminArea) return null

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'geojson')
  url.searchParams.set('polygon_geojson', '1')
  url.searchParams.set('limit', '1')
  url.searchParams.set('q', city.adminArea)
  url.searchParams.set('countrycodes', city.countryCode)

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': userAgent,
    },
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    throw new Error(`Nominatim HTTP ${response.status}`)
  }

  const payload = (await response.json()) as NominatimResponse
  const feature = payload.features?.[0]

  if (!feature?.geometry) {
    throw new Error(`Contour administratif introuvable pour ${city.adminArea}.`)
  }

  if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
    throw new Error(`Géométrie administrative inattendue pour ${city.adminArea}.`)
  }

  return {
    geometry: feature.geometry,
    boundary: {
      provider: 'Nominatim',
      placeId: feature.properties?.place_id ?? null,
      displayName: feature.properties?.display_name ?? null,
    },
  }
}

function mulberry32(initialSeed: number): () => number {
  let state = initialSeed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = result[index]
    const swapped = result[swapIndex]

    if (current === undefined || swapped === undefined) continue

    result[index] = swapped
    result[swapIndex] = current
  }

  return result
}

async function buildSample(
  city: CityInput,
  iconic: IconicInput[],
  sampleSeed: number,
  randomPerStratum: number,
  protocol: 'ADR-002' | 'calibration',
  withAdministrativeArea: boolean,
): Promise<SampleFile> {
  const sources = new Map<string, SourceInfo>()
  const record = (result: OverpassResult): OverpassElement[] => {
    sources.set(`${result.endpoint}|${result.osmBaseTimestamp}`, {
      endpoint: result.endpoint,
      osmBaseTimestamp: result.osmBaseTimestamp,
    })
    return result.elements
  }

  const area = withAdministrativeArea ? await fetchAdministrativePolygon(city) : null
  console.log(area ? 'Sélection dans le contour administratif.' : 'Sélection dans la bbox.')
  const random = mulberry32(sampleSeed)
  const used = new Set<string>()
  const iconicPlaces: SamplePlace[] = []

  if (iconic.length > 0) {
    console.log('Requête OSM : lieux iconiques.')
    const iconicPool = record(await queryPool(city, iconicFilters, true))
    const filteredPool = area
      ? iconicPool.filter((element) => {
          const point = elementPoint(element)
          return point ? pointInGeometry(point, area.geometry) : false
        })
      : iconicPool

    for (const item of iconic) {
      const element = resolveIconic(item, filteredPool)
      used.add(elementKey(element))
      iconicPlaces.push({
        kind: 'iconic',
        name: item.name,
        stratum: item.stratum,
        osm: {
          type: element.type,
          id: element.id,
        },
      })
    }
  }

  const randomPlaces: SamplePlace[] = []
  const candidateCounts = {} as Record<Stratum, number>

  for (const stratum of strata) {
    console.log(`Requête OSM : ${stratum}.`)
    const pool = record(await queryPool(city, randomFilters[stratum], false))
    const eligible = dedupe(pool)
      .filter((element) => !used.has(elementKey(element)))
      .filter((element) => {
        if (!area) return true
        const point = elementPoint(element)
        return point ? pointInGeometry(point, area.geometry) : false
      })
      .sort(compareElements)

    candidateCounts[stratum] = eligible.length
    console.log(`${stratum} : ${eligible.length} candidats.`)

    if (eligible.length < randomPerStratum) {
      throw new Error(
        `Pas assez de candidats pour ${stratum} : ${eligible.length} pour ${randomPerStratum}.`,
      )
    }

    const picked = shuffle(eligible, random).slice(0, randomPerStratum)
    const details = record(await fetchElements(picked))
    const byKey = new Map(details.map((element) => [elementKey(element), element]))

    for (const element of picked) {
      const detail = byKey.get(elementKey(element))

      if (!detail?.tags?.name) {
        throw new Error(`Détail OSM introuvable pour ${elementKey(element)}.`)
      }

      randomPlaces.push({
        kind: 'random',
        name: detail.tags.name,
        stratum,
        osm: {
          type: detail.type,
          id: detail.id,
        },
      })
      used.add(elementKey(detail))
    }

    await sleep(1_000)
  }

  const places = [...iconicPlaces, ...randomPlaces]
  const expected = iconic.length + randomPerStratum * strata.length

  if (places.length !== expected) {
    throw new Error(`Échantillon incomplet : ${places.length} lieux au lieu de ${expected}.`)
  }

  return {
    version: 1,
    protocol,
    createdAt: new Date().toISOString(),
    city: {
      ...city,
      selectionArea: area ? 'administrative polygon' : 'bbox',
      boundary: area?.boundary ?? null,
    },
    seed: sampleSeed,
    randomPerStratum,
    strata: [...strata],
    candidateCounts,
    places,
    sources: [...sources.values()],
    attribution: 'OpenStreetMap contributors',
    license: 'ODbL-1.0',
  }
}

async function writeSample(sample: SampleFile): Promise<void> {
  await mkdir(spikesDirectory, { recursive: true })
  const path = join(spikesDirectory, `osm-sample-${sample.city.id}.json`)
  await writeFile(path, `${JSON.stringify(sample, null, 2)}\n`, 'utf8')
  console.log(`Échantillon écrit : ${path} (${sample.places.length} lieux)`)
}

async function buildProtocolSample(cityId: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(cityId)) {
    throw new Error('Identifiant de ville invalide.')
  }

  const path = join(cityConfigsDirectory, `${cityId}.json`)
  const protocol = await readJson<CityProtocol>(path)

  if (protocol.city.id !== cityId) {
    throw new Error(`Identifiant incohérent dans ${path}.`)
  }

  if (protocol.iconic.length !== 15) {
    throw new Error(`Le protocole doit contenir 15 lieux iconiques.`)
  }

  if (protocol.randomPerStratum !== 5) {
    throw new Error(`Le protocole doit tirer 5 lieux par strate.`)
  }

  const sample = await buildSample(
    protocol.city,
    protocol.iconic,
    protocol.seed,
    protocol.randomPerStratum,
    'ADR-002',
    true,
  )

  await writeSample(sample)
}

async function buildReferenceSamples(): Promise<void> {
  const entries = await readdir(referenceCitiesDirectory, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const directory of directories) {
    const path = join(referenceCitiesDirectory, directory.name, 'city.json')
    const city = CityConfigSchema.parse(await readJson(path))
    const input: CityInput = {
      id: city.id,
      name: city.name,
      timezone: city.timezone,
      country: city.country,
      countryCode: city.country.toLowerCase(),
      holidayState: city.holidayRegion,
      bbox: city.bbox,
      evaluation: defaultEvaluation,
    }
    const sample = await buildSample(input, [], seed, 10, 'calibration', false)
    await writeSample(sample)
  }
}

async function main(): Promise<void> {
  const argument = process.argv[2]

  if (!argument) {
    throw new Error('Usage : osm-sample.ts <city-id> | --reference')
  }

  if (argument === '--reference') {
    await buildReferenceSamples()
    return
  }

  await buildProtocolSample(argument)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
