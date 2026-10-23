import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtractionClient } from '../extraction/client'
import { validateExtraction } from '../extraction/client'
import { EXTRACTION_PROMPT_VERSION } from '../extraction/prompt'
import type { ExtractionInvention } from '../extraction/validate'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const casesPath = join(repoRoot, 'evals', 'extraction', 'cases.json')
const recordedPath = join(repoRoot, 'evals', 'extraction', 'recorded.json')

type ExtractionCase = {
  id: string
  format: string
  text: string
}

type CasesFile = {
  version: number
  thresholds: {
    schemaValid: number
    noInvention: number
  }
  cases: ExtractionCase[]
}

type RecordedFile = {
  version: number
  source: string
  cases: Record<string, unknown>
}

export type ExtractionCaseResult = {
  id: string
  format: string
  schemaValid: boolean
  noInvention: boolean
  dayCount: number
  stopCount: number
  schemaIssues: Array<{
    code: string
    path: string
    message: string
  }>
  inventions: ExtractionInvention[]
  providerError: string | null
}

export type ExtractionEvalReport = {
  version: number
  measuredAt: string
  mode: 'recorded' | 'live'
  source: string | null
  promptVersion: string
  thresholds: CasesFile['thresholds']
  metrics: {
    total: number
    schemaValidCount: number
    noInventionCount: number
    schemaValid: number
    noInvention: number
  }
  errorSummary: {
    schema: number
    invention: number
    provider: number
  }
  errors: ExtractionCaseResult[]
  cases: ExtractionCaseResult[]
}

function assertCasesFile(value: unknown): asserts value is CasesFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Fichier de cas d’extraction invalide.')
  }

  const file = value as Partial<CasesFile>

  if (!Array.isArray(file.cases) || file.cases.length !== 10) {
    throw new Error('10 cas d’extraction attendus.')
  }

  if (
    !file.thresholds ||
    typeof file.thresholds.schemaValid !== 'number' ||
    typeof file.thresholds.noInvention !== 'number'
  ) {
    throw new Error('Seuils d’extraction manquants.')
  }

  const ids = new Set<string>()

  for (const testCase of file.cases) {
    if (
      !testCase ||
      typeof testCase.id !== 'string' ||
      testCase.id === '' ||
      typeof testCase.format !== 'string' ||
      typeof testCase.text !== 'string' ||
      testCase.text.trim() === ''
    ) {
      throw new Error('Cas d’extraction invalide.')
    }

    if (ids.has(testCase.id)) {
      throw new Error(`Cas d’extraction dupliqué : ${testCase.id}`)
    }

    ids.add(testCase.id)
  }
}

function assertRecordedFile(
  value: unknown,
  cases: ExtractionCase[],
): asserts value is RecordedFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Fichier de sorties enregistrées invalide.')
  }

  const file = value as Partial<RecordedFile>

  if (!file.cases || typeof file.cases !== 'object' || Array.isArray(file.cases)) {
    throw new Error('Sorties enregistrées manquantes.')
  }

  for (const testCase of cases) {
    if (!(testCase.id in file.cases)) {
      throw new Error(`Sortie enregistrée manquante pour ${testCase.id}.`)
    }
  }
}

function readRecorded(value: unknown, cases: ExtractionCase[]): RecordedFile {
  assertRecordedFile(value, cases)
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runExtractionEval(
  options: {
    client?: ExtractionClient
    source?: string | null
  } = {},
): Promise<ExtractionEvalReport> {
  const casesFile = JSON.parse(await readFile(casesPath, 'utf8')) as unknown

  assertCasesFile(casesFile)

  const recorded: RecordedFile | null = options.client
    ? null
    : readRecorded(JSON.parse(await readFile(recordedPath, 'utf8')) as unknown, casesFile.cases)

  const mode = options.client ? 'live' : 'recorded'
  const results: ExtractionCaseResult[] = []

  for (const testCase of casesFile.cases) {
    let raw: unknown
    let providerError: string | null = null

    try {
      raw = options.client
        ? await options.client.extract(testCase.text)
        : recorded!.cases[testCase.id]
    } catch (error) {
      providerError = errorMessage(error)
      raw = null
    }

    if (providerError) {
      results.push({
        id: testCase.id,
        format: testCase.format,
        schemaValid: false,
        noInvention: false,
        dayCount: 0,
        stopCount: 0,
        schemaIssues: [],
        inventions: [],
        providerError,
      })
      continue
    }

    const validation = validateExtraction(testCase.text, raw)

    if (validation.ok) {
      results.push({
        id: testCase.id,
        format: testCase.format,
        schemaValid: true,
        noInvention: true,
        dayCount: validation.plan.days.length,
        stopCount: validation.plan.days.reduce((count, day) => count + day.stops.length, 0),
        schemaIssues: [],
        inventions: [],
        providerError: null,
      })
      continue
    }

    if (validation.stage === 'schema') {
      results.push({
        id: testCase.id,
        format: testCase.format,
        schemaValid: false,
        noInvention: false,
        dayCount: 0,
        stopCount: 0,
        schemaIssues: validation.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.join('.'),
          message: issue.message,
        })),
        inventions: [],
        providerError: null,
      })
      continue
    }

    results.push({
      id: testCase.id,
      format: testCase.format,
      schemaValid: true,
      noInvention: false,
      dayCount: validation.plan.days.length,
      stopCount: validation.plan.days.reduce((count, day) => count + day.stops.length, 0),
      schemaIssues: [],
      inventions: validation.inventions,
      providerError: null,
    })
  }

  const total = results.length
  const schemaValidCount = results.filter((result) => result.schemaValid).length
  const noInventionCount = results.filter((result) => result.noInvention).length
  const errors = results.filter(
    (result) => !result.schemaValid || !result.noInvention || result.providerError !== null,
  )

  return {
    version: 1,
    measuredAt: new Date().toISOString(),
    mode,
    source: options.client ? (options.source ?? null) : (recorded?.source ?? null),
    promptVersion: EXTRACTION_PROMPT_VERSION,
    thresholds: casesFile.thresholds,
    metrics: {
      total,
      schemaValidCount,
      noInventionCount,
      schemaValid: schemaValidCount / total,
      noInvention: noInventionCount / total,
    },
    errorSummary: {
      schema: results.filter((result) => !result.schemaValid && result.providerError === null)
        .length,
      invention: results.filter((result) => result.schemaValid && !result.noInvention).length,
      provider: results.filter((result) => result.providerError !== null).length,
    },
    errors,
    cases: results,
  }
}
