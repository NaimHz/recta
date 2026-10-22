import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpeningHours from 'opening_hours'
import { queryOverpass, type OverpassElement, type OverpassElementType } from './overpass'

const require = createRequire(import.meta.url)
const parserVersion = (require('opening_hours/package.json') as { version: string }).version

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const spikesDirectory = join(repoRoot, 'evals', 'spikes')

type SamplePlace = {
  kind: 'iconic' | 'random'
  name: string
  stratum: string
  osm: {
    type: OverpassElementType
    id: number
  }
}

type SampleCity = {
  id: string
  name: string
  timezone: string
  country: string
  countryCode: string
  holidayState?: string
  evaluation: {
    dates: string[]
    sunday: string
    holiday: string | null
  }
}

type SampleFile = {
  version: number
  protocol: 'ADR-002' | 'calibration' | string
  createdAt: string
  city: SampleCity
  seed: number
  randomPerStratum: number
  strata: string[]
  places: SamplePlace[]
  sources: Array<{
    endpoint: string
    osmBaseTimestamp: string | null
  }>
  attribution: string
  license: string
}

type RawPlace = {
  kind: 'iconic' | 'random'
  name: string
  stratum: string
  osm: {
    type: OverpassElementType
    id: number
  }
  missing: boolean
  osmName: string | null
  openingHours: string
  checkDate: string
  parsed: boolean
  parseError: string | null
  warnings: string[]
  evaluation: Record<string, string>
}

type Metrics = {
  total: number
  withHours: number
  parsed: number
  errors: number
  missing: number
  g1: number
  g2: number
  withCheckDate: number
  staleOver365: number
  medianAgeDays: number | null
}

type CityResult = {
  sample: string
  protocol: string
  parser: {
    name: 'opening_hours'
    version: string
  }
  sources: Array<{
    endpoint: string
    osmBaseTimestamp: string | null
  }>
  sampleSources: Array<{
    endpoint: string
    osmBaseTimestamp: string | null
  }>
  metrics: {
    overall: Metrics
    iconic: Metrics
    random: Metrics
    byStratum: Record<string, Metrics>
  }
  decision: 'go' | 'no-go' | 'parser_needs_fix' | 'calibration'
  places: RawPlace[]
}

function elementKey(element: OverpassElement): string {
  return `${element.type}/${element.id}`
}

function sampleKey(place: SamplePlace): string {
  return `${place.osm.type}/${place.osm.id}`
}

async function fetchDetails(places: SamplePlace[]): Promise<{
  elements: OverpassElement[]
  endpoint: string
  osmBaseTimestamp: string | null
}> {
  const statements = places.map((place) => `${place.osm.type}(${place.osm.id});`).join('\n')
  const query = `[out:json][timeout:180];\n(\n${statements}\n);\nout tags center;`

  return queryOverpass(query)
}

function dateAgeDays(value: string, measuredAt: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)

  if (!Number.isFinite(timestamp)) return null

  return (measuredAt.getTime() - timestamp) / 86_400_000
}

function median(values: number[]): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  }

  return sorted[middle] ?? null
}

function parsePlace(
  place: SamplePlace,
  element: OverpassElement | undefined,
  city: SampleCity,
): RawPlace {
  const tags = element?.tags ?? {}
  const openingHours = tags.opening_hours?.trim() ?? ''
  const checkDate = tags.check_date?.trim() || tags['survey:date']?.trim() || ''
  const base: RawPlace = {
    kind: place.kind,
    name: place.name,
    stratum: place.stratum,
    osm: place.osm,
    missing: !element,
    osmName: tags.name ?? null,
    openingHours,
    checkDate,
    parsed: false,
    parseError: element ? null : 'Élément OSM introuvable',
    warnings: [],
    evaluation: {},
  }

  if (!element || !openingHours) {
    return base
  }

  try {
    const parser = new OpeningHours(openingHours, {
      lat: element.center?.lat ?? element.lat ?? 0,
      lon: element.center?.lon ?? element.lon ?? 0,
      address: {
        country_code: city.countryCode,
        state: city.holidayState ?? '',
      },
    })
    let warnings: string[] = []

    try {
      warnings = parser.getWarnings()
    } catch {
      warnings = []
    }

    const evaluation: Record<string, string> = {}

    for (const date of city.evaluation.dates) {
      try {
        evaluation[date] = parser.getStateString(new Date(`${date}T12:00:00`))
      } catch {
        evaluation[date] = 'error'
      }
    }

    return {
      ...base,
      parsed: true,
      warnings,
      evaluation,
    }
  } catch (error) {
    return {
      ...base,
      parsed: false,
      parseError: error instanceof Error ? error.message : String(error),
    }
  }
}

function computeMetrics(places: RawPlace[], measuredAt: Date): Metrics {
  const total = places.length
  const withHours = places.filter((place) => place.openingHours !== '').length
  const parsed = places.filter((place) => place.parsed).length
  const errors = places.filter((place) => place.openingHours !== '' && !place.parsed).length
  const missing = places.filter((place) => place.missing).length
  const withCheckDate = places.filter((place) => place.checkDate !== '').length
  const ages = places
    .map((place) => dateAgeDays(place.checkDate, measuredAt))
    .filter((age): age is number => age !== null)

  return {
    total,
    withHours,
    parsed,
    errors,
    missing,
    g1: total === 0 ? 0 : parsed / total,
    g2: withHours === 0 ? 0 : errors / withHours,
    withCheckDate,
    staleOver365: ages.filter((age) => age > 365).length,
    medianAgeDays: median(ages),
  }
}

function computeCityResult(
  sample: SampleFile,
  sampleName: string,
  elements: OverpassElement[],
  source: { endpoint: string; osmBaseTimestamp: string | null },
  measuredAt: Date,
): CityResult {
  const byKey = new Map(elements.map((element) => [elementKey(element), element]))
  const places = sample.places.map((place) =>
    parsePlace(place, byKey.get(sampleKey(place)), sample.city),
  )
  const overall = computeMetrics(places, measuredAt)
  const parserReliable = overall.g2 <= 0.1
  const decision: CityResult['decision'] =
    sample.protocol === 'ADR-002'
      ? parserReliable
        ? overall.g1 >= 0.6
          ? 'go'
          : 'no-go'
        : 'parser_needs_fix'
      : 'calibration'
  const byStratum = Object.fromEntries(
    sample.strata.map((stratum) => [
      stratum,
      computeMetrics(
        places.filter((place) => place.stratum === stratum),
        measuredAt,
      ),
    ]),
  )

  return {
    sample: sampleName,
    protocol: sample.protocol,
    parser: {
      name: 'opening_hours',
      version: parserVersion,
    },
    sources: [source],
    sampleSources: sample.sources,
    metrics: {
      overall,
      iconic: computeMetrics(
        places.filter((place) => place.kind === 'iconic'),
        measuredAt,
      ),
      random: computeMetrics(
        places.filter((place) => place.kind === 'random'),
        measuredAt,
      ),
      byStratum,
    },
    decision,
    places,
  }
}

function toSummary(result: CityResult): Omit<CityResult, 'places'> {
  return {
    sample: result.sample,
    protocol: result.protocol,
    parser: result.parser,
    sources: result.sources,
    sampleSources: result.sampleSources,
    metrics: result.metrics,
    decision: result.decision,
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)} %`
}

async function main(): Promise<void> {
  const mode = process.argv.includes('--reference') ? 'reference' : 'all'
  const entries = await readdir(spikesDirectory)
  const sampleFiles = entries
    .filter((entry) => /^osm-sample-.*\.json$/.test(entry))
    .sort((left, right) => left.localeCompare(right))
  const selected: Array<{ file: string; sample: SampleFile }> = []

  for (const file of sampleFiles) {
    const sample = JSON.parse(await readFile(join(spikesDirectory, file), 'utf8')) as SampleFile

    if (mode === 'reference' && sample.protocol !== 'calibration') continue

    selected.push({ file, sample })
  }

  if (selected.length === 0) {
    throw new Error(
      mode === 'reference'
        ? 'Aucun échantillon de calibration trouvé.'
        : 'Aucun échantillon OSM trouvé.',
    )
  }

  const measuredAt = new Date()
  const rawCities: Record<string, CityResult> = {}
  const summaryCities: Record<string, Omit<CityResult, 'places'>> = {}
  const decisions: Record<string, CityResult['decision']> = {}

  for (const { file, sample } of selected) {
    console.log(`Mesure : ${sample.city.name} (${sample.places.length} lieux).`)
    const details = await fetchDetails(sample.places)
    const result = computeCityResult(
      sample,
      file,
      details.elements,
      {
        endpoint: details.endpoint,
        osmBaseTimestamp: details.osmBaseTimestamp,
      },
      measuredAt,
    )
    rawCities[sample.city.id] = result
    summaryCities[sample.city.id] = toSummary(result)
    decisions[sample.city.id] = result.decision
    console.log(
      `G1 ${formatPercent(result.metrics.overall.g1)} | G2 ${formatPercent(
        result.metrics.overall.g2,
      )} | décision ${result.decision}`,
    )
  }

  const suffix = mode === 'reference' ? '-reference' : selected.length > 1 ? '-all' : ''
  const rawName = `osm-raw${suffix}.json`
  const summaryName = `osm-summary${suffix}.json`
  const raw = {
    version: 1,
    measuredAt: measuredAt.toISOString(),
    parser: {
      name: 'opening_hours',
      version: parserVersion,
    },
    attribution: 'OpenStreetMap contributors',
    license: 'ODbL-1.0',
    cities: rawCities,
  }
  const summary = {
    version: 1,
    measuredAt: measuredAt.toISOString(),
    parser: {
      name: 'opening_hours',
      version: parserVersion,
    },
    attribution: 'OpenStreetMap contributors',
    license: 'ODbL-1.0',
    cities: summaryCities,
    decision: decisions,
  }

  await writeFile(join(spikesDirectory, rawName), `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  await writeFile(
    join(spikesDirectory, summaryName),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  )
  console.log(`Résultats écrits dans evals/spikes/${rawName} et evals/spikes/${summaryName}.`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
