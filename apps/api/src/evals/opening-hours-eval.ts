import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkOpeningHoursAt,
  checkOpeningHoursWindow,
  CityConfigSchema,
  type CityConfig,
  type OpeningHoursCheck,
  type OpeningHoursContext,
  type OpeningHoursReason,
  type VerificationStatus,
} from '@recta/domain'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const casesPath = join(repoRoot, 'evals', 'opening-hours', 'cases.json')
const citiesDirectory = join(repoRoot, 'packages', 'data', 'cities')

export type OpeningHoursCheckInput =
  | {
      kind: 'at'
      instant: string
    }
  | {
      kind: 'window'
      date: string
      start: string
      end: string
    }

type ContextOverride = {
  timezone?: string
  countryCode?: string
  holidayRegion?: string
  coordinates?: {
    lat: number
    lon: number
  }
}

export type OpeningHoursCase = {
  id: string
  city: string
  raw: string | null
  check: OpeningHoursCheckInput
  contextOverride?: ContextOverride
  expected: {
    status: VerificationStatus
    reason: OpeningHoursReason
    holiday?: boolean
  }
}

type CasesFile = {
  version: number
  thresholds: {
    exact: number
  }
  cases: OpeningHoursCase[]
}

export type OpeningHoursCaseResult = {
  id: string
  city: string
  raw: string | null
  check: OpeningHoursCheckInput
  expected: OpeningHoursCase['expected']
  actual: {
    status: VerificationStatus
    reason: OpeningHoursReason
    holiday: boolean
    local: OpeningHoursCheck['local']
    warnings: string[]
  }
  correct: boolean
  category: string | null
}

export type OpeningHoursEvalReport = {
  version: number
  measuredAt: string
  thresholds: {
    exact: number
  }
  metrics: {
    total: number
    correct: number
    correctRate: number
    byStatus: Record<VerificationStatus, { total: number; correct: number }>
    byReason: Record<string, { total: number; correct: number }>
  }
  errorSummary: Array<{
    category: string
    count: number
    caseIds: string[]
  }>
  errors: OpeningHoursCaseResult[]
  cases: OpeningHoursCaseResult[]
}

const STATUSES: readonly VerificationStatus[] = ['conforme', 'violation', 'indéterminé']
const REASONS: readonly OpeningHoursReason[] = [
  'open',
  'closed',
  'closes_during_stop',
  'unknown',
  'missing_hours',
  'invalid_syntax',
  'invalid_timezone',
  'invalid_context',
  'invalid_local_time',
]

function assertCasesFile(value: unknown): asserts value is CasesFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Fichier de cas horaires invalide.')
  }

  const file = value as Partial<CasesFile>

  if (!Array.isArray(file.cases) || file.cases.length !== 40) {
    throw new Error('40 cas horaires attendus.')
  }

  if (!file.thresholds || typeof file.thresholds.exact !== 'number') {
    throw new Error('Seuil d’exactitude manquant.')
  }

  const seenIds = new Set<string>()

  for (const testCase of file.cases) {
    if (!testCase || typeof testCase !== 'object') {
      throw new Error('Cas horaire invalide.')
    }

    if (typeof testCase.id !== 'string' || testCase.id === '') {
      throw new Error('Identifiant de cas horaire manquant.')
    }

    if (seenIds.has(testCase.id)) {
      throw new Error(`Cas horaire dupliqué : ${testCase.id}`)
    }

    seenIds.add(testCase.id)

    if (typeof testCase.city !== 'string' || testCase.city === '') {
      throw new Error(`Ville manquante pour ${testCase.id}.`)
    }

    if (testCase.raw !== null && typeof testCase.raw !== 'string') {
      throw new Error(`Horaires invalides pour ${testCase.id}.`)
    }

    if (!testCase.check || (testCase.check.kind !== 'at' && testCase.check.kind !== 'window')) {
      throw new Error(`Type de vérification invalide pour ${testCase.id}.`)
    }

    if (testCase.check.kind === 'at' && typeof testCase.check.instant !== 'string') {
      throw new Error(`Instant manquant pour ${testCase.id}.`)
    }

    if (
      testCase.check.kind === 'window' &&
      (typeof testCase.check.date !== 'string' ||
        typeof testCase.check.start !== 'string' ||
        typeof testCase.check.end !== 'string')
    ) {
      throw new Error(`Fenêtre incomplète pour ${testCase.id}.`)
    }

    if (
      !testCase.expected ||
      !STATUSES.includes(testCase.expected.status) ||
      !REASONS.includes(testCase.expected.reason)
    ) {
      throw new Error(`Réponse attendue invalide pour ${testCase.id}.`)
    }
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

function contextFor(city: CityConfig, override?: ContextOverride): OpeningHoursContext {
  const center = {
    lat: (city.bbox[1] + city.bbox[3]) / 2,
    lon: (city.bbox[0] + city.bbox[2]) / 2,
  }

  return {
    timezone: override?.timezone ?? city.timezone,
    countryCode: override?.countryCode ?? city.country,
    holidayRegion: override?.holidayRegion ?? city.holidayRegion,
    coordinates: override?.coordinates ?? center,
  }
}

function checkCase(testCase: OpeningHoursCase, context: OpeningHoursContext): OpeningHoursCheck {
  if (testCase.check.kind === 'at') {
    return checkOpeningHoursAt(testCase.raw, context, new Date(testCase.check.instant))
  }

  return checkOpeningHoursWindow(testCase.raw, context, {
    date: testCase.check.date,
    start: testCase.check.start,
    end: testCase.check.end,
  })
}

function errorCategory(
  actual: OpeningHoursCheck,
  expected: OpeningHoursCase['expected'],
): string | null {
  if (actual.status !== expected.status) {
    return `statut_${expected.status}_vers_${actual.status}`
  }

  if (actual.reason !== expected.reason) {
    return `raison_${expected.reason}_vers_${actual.reason}`
  }

  if (expected.holiday !== undefined && actual.holiday !== expected.holiday) {
    return `ferie_${String(expected.holiday)}_vers_${String(actual.holiday)}`
  }

  return null
}

function summarizeStatus(
  results: OpeningHoursCaseResult[],
  status: VerificationStatus,
): { total: number; correct: number } {
  const subset = results.filter((result) => result.expected.status === status)

  return {
    total: subset.length,
    correct: subset.filter((result) => result.correct).length,
  }
}

export async function runOpeningHoursEval(): Promise<OpeningHoursEvalReport> {
  const casesFile = JSON.parse(await readFile(casesPath, 'utf8')) as unknown

  assertCasesFile(casesFile)

  const cityConfigs = await readCityConfigs()
  const results: OpeningHoursCaseResult[] = []

  for (const testCase of casesFile.cases) {
    const city = cityConfigs.get(testCase.city)

    if (!city) {
      throw new Error(`Ville inconnue pour ${testCase.id} : ${testCase.city}`)
    }

    const actual = checkCase(testCase, contextFor(city, testCase.contextOverride))
    const category = errorCategory(actual, testCase.expected)

    results.push({
      id: testCase.id,
      city: testCase.city,
      raw: testCase.raw,
      check: testCase.check,
      expected: testCase.expected,
      actual: {
        status: actual.status,
        reason: actual.reason,
        holiday: actual.holiday,
        local: actual.local,
        warnings: actual.warnings,
      },
      correct: category === null,
      category,
    })
  }

  const total = results.length
  const correct = results.filter((result) => result.correct).length
  const errors = results.filter((result) => !result.correct)
  const categories = [...new Set(errors.map((error) => error.category ?? 'inconnue'))].sort()
  const errorSummary = categories.map((category) => {
    const caseIds = errors
      .filter((error) => (error.category ?? 'inconnue') === category)
      .map((error) => error.id)

    return { category, count: caseIds.length, caseIds }
  })
  const reasons = [...new Set(results.map((result) => result.expected.reason))].sort()
  const byReason = Object.fromEntries(
    reasons.map((reason) => {
      const subset = results.filter((result) => result.expected.reason === reason)

      return [
        reason,
        {
          total: subset.length,
          correct: subset.filter((result) => result.correct).length,
        },
      ]
    }),
  )

  return {
    version: 1,
    measuredAt: new Date().toISOString(),
    thresholds: casesFile.thresholds,
    metrics: {
      total,
      correct,
      correctRate: correct / total,
      byStatus: {
        conforme: summarizeStatus(results, 'conforme'),
        violation: summarizeStatus(results, 'violation'),
        indéterminé: summarizeStatus(results, 'indéterminé'),
      },
      byReason,
    },
    errorSummary,
    errors,
    cases: results,
  }
}
