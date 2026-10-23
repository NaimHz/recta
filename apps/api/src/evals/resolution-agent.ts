import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CityConfigSchema,
  PlaceSchema,
  runResolutionAgent,
  type CityConfig,
  type Place,
  type PlaceSearchTool,
  type ResolutionAgentResult,
  type ResolutionSearchInput,
} from '@recta/domain'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const casesPath = join(repoRoot, 'evals', 'resolution', 'agent-cases.json')
const reportPath = join(repoRoot, 'evals', 'resolution', 'agent-report.json')
const citiesDirectory = join(repoRoot, 'packages', 'data', 'cities')

type ExpectedResolution =
  | {
      status: 'resolved'
      placeId: string
    }
  | {
      status: 'needs_clarification'
      optionIds: string[]
    }
  | {
      status: 'not_found'
      questionIncludes?: string
    }

type ResolutionAgentCase = {
  id: string
  city: string
  query: string
  type?: string
  expected: ExpectedResolution
}

type AgentCasesFile = {
  version: number
  maxCalls: number
  thresholds: {
    good: number
    inventions: number
  }
  candidateSource: string
  cases: ResolutionAgentCase[]
}

type CandidateCity = {
  id: string
  places: unknown[]
}

type CandidateFile = {
  cities: CandidateCity[]
}

type AgentCaseResult = {
  id: string
  city: string
  query: string
  type: string | null
  expected: ExpectedResolution
  good: boolean
  status: ResolutionAgentResult['status']
  placeId: string | null
  placeName: string | null
  question: string | null
  options: ResolutionAgentResult['options']
  optionIds: string[]
  usedCalls: number
  inventions: string[]
  journal: ResolutionAgentResult['journal']
}

class FixturePlaceSearch implements PlaceSearchTool {
  readonly name = 'fixture.search'

  constructor(private readonly placesByCity: ReadonlyMap<string, readonly Place[]>) {}

  async search(input: ResolutionSearchInput): Promise<Place[]> {
    return [...(this.placesByCity.get(input.city.id) ?? [])]
  }
}

function assertCasesFile(value: unknown): asserts value is AgentCasesFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Fichier de cas agent invalide.')
  }

  const file = value as Partial<AgentCasesFile>

  if (!Array.isArray(file.cases) || file.cases.length !== 10) {
    throw new Error('10 cas agent attendus.')
  }

  if (typeof file.maxCalls !== 'number') {
    throw new Error('Budget d’appels manquant.')
  }

  if (!file.thresholds || typeof file.thresholds.good !== 'number') {
    throw new Error('Seuil de réussite manquant.')
  }

  if (typeof file.thresholds.inventions !== 'number') {
    throw new Error('Seuil d’invention manquant.')
  }

  if (typeof file.candidateSource !== 'string') {
    throw new Error('Source de candidats manquante.')
  }
}

function assertCandidateFile(value: unknown): asserts value is CandidateFile {
  if (!value || typeof value !== 'object' || !Array.isArray((value as CandidateFile).cities)) {
    throw new Error('Fichier de candidats invalide.')
  }
}

async function readCityConfigs(): Promise<Map<string, CityConfig>> {
  const entries = await readdir(citiesDirectory, { withFileTypes: true })
  const cities = new Map<string, CityConfig>()

  for (const entry of entries.filter((item) => item.isDirectory())) {
    const path = join(citiesDirectory, entry.name, 'city.json')
    const city = CityConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))

    cities.set(city.id, city)
  }

  return cities
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')} %`
}

function isGoodResult(result: ResolutionAgentResult, expected: ExpectedResolution): boolean {
  if (result.place !== null && result.status !== 'resolved') return false

  if (expected.status === 'resolved') {
    return result.status === 'resolved' && result.place?.id === expected.placeId
  }

  if (expected.status === 'needs_clarification') {
    const optionIds = new Set(result.options.map((option) => option.id))

    return (
      result.status === 'needs_clarification' &&
      result.place === null &&
      typeof result.question === 'string' &&
      result.question.endsWith('?') &&
      expected.optionIds.every((id) => optionIds.has(id))
    )
  }

  return (
    result.status === 'not_found' &&
    result.place === null &&
    result.options.length === 0 &&
    typeof result.question === 'string' &&
    result.question.endsWith('?') &&
    (!expected.questionIncludes || result.question.includes(expected.questionIncludes))
  )
}

async function main(): Promise<void> {
  const casesFile = JSON.parse(await readFile(casesPath, 'utf8')) as unknown

  assertCasesFile(casesFile)

  const candidatesFile = JSON.parse(
    await readFile(join(repoRoot, casesFile.candidateSource), 'utf8'),
  ) as unknown

  assertCandidateFile(candidatesFile)

  const candidatesByCity = new Map<string, Place[]>()
  const knownIdsByCity = new Map<string, Set<string>>()

  for (const city of candidatesFile.cities) {
    const places = city.places.map((place) => PlaceSchema.parse(place))

    candidatesByCity.set(city.id, places)
    knownIdsByCity.set(city.id, new Set(places.map((place) => place.id)))
  }

  const cityConfigs = await readCityConfigs()
  const search = new FixturePlaceSearch(candidatesByCity)
  const results: AgentCaseResult[] = []

  for (const testCase of casesFile.cases) {
    const city = cityConfigs.get(testCase.city)

    if (!city) throw new Error(`Ville inconnue : ${testCase.city}`)

    const candidates = candidatesByCity.get(testCase.city)
    const knownIds = knownIdsByCity.get(testCase.city)

    if (!candidates || !knownIds) throw new Error(`Candidats absents : ${testCase.city}`)

    if (testCase.expected.status === 'resolved' && !knownIds.has(testCase.expected.placeId)) {
      throw new Error(`Lieu attendu absent du pool : ${testCase.expected.placeId}`)
    }

    if (testCase.expected.status === 'needs_clarification') {
      for (const optionId of testCase.expected.optionIds) {
        if (!knownIds.has(optionId)) {
          throw new Error(`Option attendue absente du pool : ${optionId}`)
        }
      }
    }

    const result = await runResolutionAgent(
      {
        name: testCase.query,
        city,
        ...(testCase.type ? { type: testCase.type } : {}),
      },
      {
        search,
        maxCalls: casesFile.maxCalls,
      },
    )

    const usedIds = [
      ...(result.place ? [result.place.id] : []),
      ...result.options.map((option) => option.id),
    ]
    const inventions = usedIds.filter((id) => !knownIds.has(id))
    const good = isGoodResult(result, testCase.expected)

    results.push({
      id: testCase.id,
      city: testCase.city,
      query: testCase.query,
      type: testCase.type ?? null,
      expected: testCase.expected,
      good,
      status: result.status,
      placeId: result.place?.id ?? null,
      placeName: result.place?.name ?? null,
      question: result.question,
      options: result.options,
      optionIds: result.options.map((option) => option.id),
      usedCalls: result.budget.usedCalls,
      inventions,
      journal: result.journal,
    })
  }

  const total = results.length
  const goodCount = results.filter((result) => result.good).length
  const inventions = results.reduce((count, result) => count + result.inventions.length, 0)
  const budgetExceeded = results.filter((result) => result.usedCalls > casesFile.maxCalls).length
  const resolvedCorrect = results.filter(
    (result) => result.status === 'resolved' && result.good,
  ).length
  const clarifications = results.filter((result) => result.status === 'needs_clarification').length
  const notFound = results.filter((result) => result.status === 'not_found').length
  const metrics = {
    total,
    good: goodCount,
    goodRate: goodCount / total,
    resolvedCorrect,
    clarifications,
    notFound,
    inventions,
    budgetExceeded,
  }

  const report = {
    version: 1,
    measuredAt: new Date().toISOString(),
    candidateSource: casesFile.candidateSource,
    maxCalls: casesFile.maxCalls,
    thresholds: casesFile.thresholds,
    metrics,
    cases: results,
  }

  await mkdir(join(repoRoot, 'evals', 'resolution'), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(
    `${total} cas | bons ${goodCount}/${total} (${percentage(metrics.goodRate)}) | ` +
      `résolus ${resolvedCorrect} | questions ${clarifications} | introuvables ${notFound} | ` +
      `inventions ${inventions} | budget dépassé ${budgetExceeded}`,
  )
  console.log(
    `Seuils : bons ≥ ${percentage(casesFile.thresholds.good)}, ` +
      `inventions ≤ ${casesFile.thresholds.inventions}`,
  )
  console.log(`Rapport : ${reportPath}`)

  if (
    metrics.goodRate < casesFile.thresholds.good ||
    metrics.inventions > casesFile.thresholds.inventions
  ) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
