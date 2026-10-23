import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ExtractedPlanSchema,
  normalizeExtractedStop,
  stopTypeKeyFor,
  type ExtractedPlan,
  type ExtractedStop,
} from '@recta/domain'
import type { ExtractionClient } from '../extraction/client'
import { validateExtraction } from '../extraction/client'
import { EXTRACTION_PROMPT_VERSION } from '../extraction/prompt'
import { findInventions, type ExtractionInvention } from '../extraction/validate'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const casesPath = join(repoRoot, 'evals', 'extraction-f1', 'cases.json')
const goldPath = join(repoRoot, 'evals', 'extraction-f1', 'gold.json')

export const EXTRACTION_F1_FORMATS = ['whatsapp', 'email', 'article'] as const
export type ExtractionF1Format = (typeof EXTRACTION_F1_FORMATS)[number]

export const F1_FIELDS = [
  'name',
  'startText',
  'endText',
  'type',
  'dateText',
  'city',
  'timezoneText',
] as const
export type F1Field = (typeof F1_FIELDS)[number]

export const F1_ERROR_CATEGORIES = [
  'provider',
  'schema',
  'invention',
  'missing_day',
  'extra_day',
  'wrong_date',
  'wrong_city',
  'wrong_timezone',
  'missing_stop',
  'extra_stop',
  'wrong_name',
  'wrong_start',
  'wrong_end',
  'wrong_type',
] as const
export type F1ErrorCategory = (typeof F1_ERROR_CATEGORIES)[number]

export type FieldCounts = {
  tp: number
  fp: number
  fn: number
}

export type FieldScore = FieldCounts & {
  precision: number
  recall: number
  f1: number
}

export type ExtractionF1Case = {
  id: string
  format: ExtractionF1Format
  text: string
}

type CasesFile = {
  version: number
  formats: ExtractionF1Format[]
  thresholds: {
    schemaValid: number
    noInvention: number
  }
  cases: ExtractionF1Case[]
}

type GoldFile = {
  version: number
  source: string
  cases: Record<string, ExtractedPlan>
}

export type RecordedOutput =
  | {
      ok: true
      output: unknown
    }
  | {
      ok: false
      error: string
    }

export type RecordedFile = {
  version: number
  source: string | null
  promptVersion: string
  measuredAt: string
  outputs: Record<string, RecordedOutput>
}

export type ExtractionF1CaseResult = {
  id: string
  format: ExtractionF1Format
  schemaValid: boolean
  noInvention: boolean
  providerError: string | null
  dayCount: {
    gold: number
    predicted: number
    matched: number
  }
  stopCount: {
    gold: number
    predicted: number
    matched: number
  }
  fieldCounts: Record<F1Field, FieldCounts>
  schemaIssues: Array<{
    code: string
    path: string
    message: string
  }>
  inventions: ExtractionInvention[]
  errors: F1ErrorCategory[]
}

export type ExtractionF1Report = {
  version: number
  measuredAt: string
  mode: 'recorded' | 'live'
  source: string | null
  promptVersion: string
  corpus: {
    total: number
    formats: Record<ExtractionF1Format, number>
    goldSource: string
  }
  thresholds: CasesFile['thresholds']
  metrics: {
    total: number
    schemaValidCount: number
    noInventionCount: number
    schemaValid: number
    noInvention: number
    exactPlanCount: number
    dayCount: {
      gold: number
      predicted: number
      matched: number
    }
    stopCount: {
      gold: number
      predicted: number
      matched: number
    }
    fieldScores: Record<F1Field, FieldScore>
    macroF1: number
    microF1: number
  }
  byFormat: Record<
    ExtractionF1Format,
    {
      total: number
      schemaValidCount: number
      noInventionCount: number
      macroF1: number
      microF1: number
      fieldScores: Record<F1Field, FieldScore>
    }
  >
  errorSummary: Record<F1ErrorCategory, number>
  errors: ExtractionF1CaseResult[]
  cases: ExtractionF1CaseResult[]
}

const NAME_STOP_WORDS = new Set([
  'a',
  'au',
  'aux',
  'd',
  'de',
  'des',
  'du',
  'en',
  'et',
  'l',
  'la',
  'le',
  'les',
  'of',
  'the',
  'un',
  'une',
])

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function nameTokens(value: string): string[] {
  return normalizeLabel(value)
    .split(' ')
    .filter((token) => token.length > 0 && !NAME_STOP_WORDS.has(token))
}

function nameSimilarity(left: string, right: string): number {
  const leftTokens = nameTokens(left)
  const rightTokens = nameTokens(right)

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return leftTokens.length === rightTokens.length ? 1 : 0
  }

  const leftSet = new Set(leftTokens)
  const rightSet = new Set(rightTokens)
  let shared = 0

  for (const token of leftSet) {
    if (rightSet.has(token)) shared += 1
  }

  return shared / (leftSet.size + rightSet.size - shared)
}

function namesEquivalent(left: string, right: string): boolean {
  return normalizeLabel(left) === normalizeLabel(right) || nameSimilarity(left, right) >= 0.5
}

function labelsEquivalent(left: string, right: string): boolean {
  return normalizeLabel(left) === normalizeLabel(right)
}

function normalizeDateLabel(value: string): string {
  return normalizeLabel(value).replace(/^(?:le|la|les|l|du|de|des|on)\s+/, '')
}

function datesEquivalent(left: string, right: string): boolean {
  return normalizeDateLabel(left) === normalizeDateLabel(right)
}

function typeFamily(value: string | null): string | null {
  if (value === null) return null

  const key = stopTypeKeyFor(value)

  return key === 'other' ? normalizeLabel(value) : key
}

function typesEquivalent(left: string, right: string): boolean {
  return typeFamily(left) === typeFamily(right)
}

function canonicalTimeEdge(raw: string, edge: 'start' | 'end'): string {
  const stop: ExtractedStop = {
    name: raw,
    startText: edge === 'start' ? raw : null,
    endText: edge === 'end' ? raw : null,
    type: null,
    sourceText: raw,
  }
  const normalized = normalizeExtractedStop(stop)
  const value = edge === 'start' ? normalized.start : normalized.end

  return value ?? normalizeLabel(raw)
}

function timeEdgesEquivalent(left: string, right: string, edge: 'start' | 'end'): boolean {
  return canonicalTimeEdge(left, edge) === canonicalTimeEdge(right, edge)
}

function emptyFieldCounts(): Record<F1Field, FieldCounts> {
  return Object.fromEntries(F1_FIELDS.map((field) => [field, { tp: 0, fp: 0, fn: 0 }])) as Record<
    F1Field,
    FieldCounts
  >
}

function addField(
  counts: Record<F1Field, FieldCounts>,
  field: F1Field,
  gold: string | null,
  predicted: string | null,
  equivalent: (left: string, right: string) => boolean,
): void {
  const target = counts[field]

  if (gold === null && predicted === null) return

  if (gold === null) {
    target.fp += 1
    return
  }

  if (predicted === null) {
    target.fn += 1
    return
  }

  if (equivalent(gold, predicted)) {
    target.tp += 1
    return
  }

  target.fp += 1
  target.fn += 1
}

function fieldMatches(
  gold: string | null,
  predicted: string | null,
  equivalent: (left: string, right: string) => boolean,
): boolean {
  if (gold === null && predicted === null) return true
  if (gold === null || predicted === null) return false

  return equivalent(gold, predicted)
}

function addComparedField(
  counts: Record<F1Field, FieldCounts>,
  errors: Set<F1ErrorCategory>,
  field: F1Field,
  error: F1ErrorCategory,
  gold: string | null,
  predicted: string | null,
  equivalent: (left: string, right: string) => boolean,
): void {
  addField(counts, field, gold, predicted, equivalent)

  if (!fieldMatches(gold, predicted, equivalent)) {
    errors.add(error)
  }
}

function addMissedGoldStop(counts: Record<F1Field, FieldCounts>, stop: ExtractedStop): void {
  addField(counts, 'name', stop.name, null, namesEquivalent)
  addField(counts, 'startText', stop.startText, null, (left, right) =>
    timeEdgesEquivalent(left, right, 'start'),
  )
  addField(counts, 'endText', stop.endText, null, (left, right) =>
    timeEdgesEquivalent(left, right, 'end'),
  )
  addField(counts, 'type', stop.type, null, typesEquivalent)
}

function addExtraPredictedStop(counts: Record<F1Field, FieldCounts>, stop: ExtractedStop): void {
  addField(counts, 'name', null, stop.name, namesEquivalent)
  addField(counts, 'startText', null, stop.startText, (left, right) =>
    timeEdgesEquivalent(left, right, 'start'),
  )
  addField(counts, 'endText', null, stop.endText, (left, right) =>
    timeEdgesEquivalent(left, right, 'end'),
  )
  addField(counts, 'type', null, stop.type, typesEquivalent)
}

function addMissedGoldDay(
  counts: Record<F1Field, FieldCounts>,
  day: ExtractedPlan['days'][number],
): void {
  addField(counts, 'dateText', day.dateText, null, datesEquivalent)
  addField(counts, 'city', day.city, null, labelsEquivalent)
  addField(counts, 'timezoneText', day.timezoneText, null, labelsEquivalent)

  for (const stop of day.stops) {
    addMissedGoldStop(counts, stop)
  }
}

function addExtraPredictedDay(
  counts: Record<F1Field, FieldCounts>,
  day: ExtractedPlan['days'][number],
): void {
  addField(counts, 'dateText', null, day.dateText, datesEquivalent)
  addField(counts, 'city', null, day.city, labelsEquivalent)
  addField(counts, 'timezoneText', null, day.timezoneText, labelsEquivalent)

  for (const stop of day.stops) {
    addExtraPredictedStop(counts, stop)
  }
}

function pairDays(
  goldDays: ExtractedPlan['days'],
  predictedDays: ExtractedPlan['days'],
): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  const usedGold = new Set<number>()
  const usedPredicted = new Set<number>()

  const pair = (goldIndex: number, predictedIndex: number) => {
    pairs.push([goldIndex, predictedIndex])
    usedGold.add(goldIndex)
    usedPredicted.add(predictedIndex)
  }

  for (let goldIndex = 0; goldIndex < goldDays.length; goldIndex += 1) {
    const goldDay = goldDays[goldIndex]
    if (!goldDay?.dateText) continue

    const goldKey = normalizeLabel(goldDay.dateText)
    const predictedIndex = predictedDays.findIndex(
      (day, index) =>
        !usedPredicted.has(index) &&
        day.dateText !== null &&
        normalizeLabel(day.dateText) === goldKey,
    )

    if (predictedIndex >= 0) pair(goldIndex, predictedIndex)
  }

  for (let goldIndex = 0; goldIndex < goldDays.length; goldIndex += 1) {
    if (usedGold.has(goldIndex)) continue
    if (goldIndex < predictedDays.length && !usedPredicted.has(goldIndex)) {
      pair(goldIndex, goldIndex)
    }
  }

  let predictedIndex = 0
  for (let goldIndex = 0; goldIndex < goldDays.length; goldIndex += 1) {
    if (usedGold.has(goldIndex)) continue

    while (predictedIndex < predictedDays.length && usedPredicted.has(predictedIndex)) {
      predictedIndex += 1
    }

    if (predictedIndex < predictedDays.length) {
      pair(goldIndex, predictedIndex)
      predictedIndex += 1
    }
  }

  return pairs.sort((left, right) => left[0] - right[0])
}

function pairStops(
  goldStops: ExtractedStop[],
  predictedStops: ExtractedStop[],
): Array<[number, number]> {
  const candidates: Array<{ goldIndex: number; predictedIndex: number; score: number }> = []

  for (let goldIndex = 0; goldIndex < goldStops.length; goldIndex += 1) {
    for (let predictedIndex = 0; predictedIndex < predictedStops.length; predictedIndex += 1) {
      const goldStop = goldStops[goldIndex]
      const predictedStop = predictedStops[predictedIndex]

      if (!goldStop || !predictedStop) continue

      const score = nameSimilarity(goldStop.name, predictedStop.name)

      if (score >= 0.4) {
        candidates.push({ goldIndex, predictedIndex, score })
      }
    }
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      Math.abs(left.goldIndex - left.predictedIndex) -
        Math.abs(right.goldIndex - right.predictedIndex),
  )

  const pairs: Array<[number, number]> = []
  const usedGold = new Set<number>()
  const usedPredicted = new Set<number>()

  for (const candidate of candidates) {
    if (usedGold.has(candidate.goldIndex) || usedPredicted.has(candidate.predictedIndex)) continue

    pairs.push([candidate.goldIndex, candidate.predictedIndex])
    usedGold.add(candidate.goldIndex)
    usedPredicted.add(candidate.predictedIndex)
  }

  const remainingGold = goldStops.map((_, index) => index).filter((index) => !usedGold.has(index))
  const remainingPredicted = predictedStops
    .map((_, index) => index)
    .filter((index) => !usedPredicted.has(index))

  for (
    let index = 0;
    index < Math.min(remainingGold.length, remainingPredicted.length);
    index += 1
  ) {
    const goldIndex = remainingGold[index]
    const predictedIndex = remainingPredicted[index]

    if (goldIndex !== undefined && predictedIndex !== undefined) {
      pairs.push([goldIndex, predictedIndex])
    }
  }

  return pairs.sort((left, right) => left[0] - right[0])
}

type PlanComparison = {
  fieldCounts: Record<F1Field, FieldCounts>
  dayCount: ExtractionF1CaseResult['dayCount']
  stopCount: ExtractionF1CaseResult['stopCount']
  errors: Set<F1ErrorCategory>
}

function comparePlans(gold: ExtractedPlan, predicted: ExtractedPlan): PlanComparison {
  const fieldCounts = emptyFieldCounts()
  const errors = new Set<F1ErrorCategory>()
  const dayPairs = pairDays(gold.days, predicted.days)
  const matchedGoldDays = new Set(dayPairs.map(([goldIndex]) => goldIndex))
  const matchedPredictedDays = new Set(dayPairs.map(([, predictedIndex]) => predictedIndex))
  let matchedStops = 0

  for (const [goldDayIndex, predictedDayIndex] of dayPairs) {
    const goldDay = gold.days[goldDayIndex]
    const predictedDay = predicted.days[predictedDayIndex]

    if (!goldDay || !predictedDay) continue

    addComparedField(
      fieldCounts,
      errors,
      'dateText',
      'wrong_date',
      goldDay.dateText,
      predictedDay.dateText,
      datesEquivalent,
    )
    addComparedField(
      fieldCounts,
      errors,
      'city',
      'wrong_city',
      goldDay.city,
      predictedDay.city,
      labelsEquivalent,
    )
    addComparedField(
      fieldCounts,
      errors,
      'timezoneText',
      'wrong_timezone',
      goldDay.timezoneText,
      predictedDay.timezoneText,
      labelsEquivalent,
    )

    const stopPairs = pairStops(goldDay.stops, predictedDay.stops)
    const matchedGoldStops = new Set(stopPairs.map(([goldIndex]) => goldIndex))
    const matchedPredictedStops = new Set(stopPairs.map(([, predictedIndex]) => predictedIndex))
    matchedStops += stopPairs.length

    for (const [goldStopIndex, predictedStopIndex] of stopPairs) {
      const goldStop = goldDay.stops[goldStopIndex]
      const predictedStop = predictedDay.stops[predictedStopIndex]

      if (!goldStop || !predictedStop) continue

      addComparedField(
        fieldCounts,
        errors,
        'name',
        'wrong_name',
        goldStop.name,
        predictedStop.name,
        namesEquivalent,
      )
      addComparedField(
        fieldCounts,
        errors,
        'startText',
        'wrong_start',
        goldStop.startText,
        predictedStop.startText,
        (left, right) => timeEdgesEquivalent(left, right, 'start'),
      )
      addComparedField(
        fieldCounts,
        errors,
        'endText',
        'wrong_end',
        goldStop.endText,
        predictedStop.endText,
        (left, right) => timeEdgesEquivalent(left, right, 'end'),
      )
      addComparedField(
        fieldCounts,
        errors,
        'type',
        'wrong_type',
        goldStop.type,
        predictedStop.type,
        typesEquivalent,
      )
    }

    for (let stopIndex = 0; stopIndex < goldDay.stops.length; stopIndex += 1) {
      if (matchedGoldStops.has(stopIndex)) continue

      const stop = goldDay.stops[stopIndex]
      if (stop) addMissedGoldStop(fieldCounts, stop)
      errors.add('missing_stop')
    }

    for (let stopIndex = 0; stopIndex < predictedDay.stops.length; stopIndex += 1) {
      if (matchedPredictedStops.has(stopIndex)) continue

      const stop = predictedDay.stops[stopIndex]
      if (stop) addExtraPredictedStop(fieldCounts, stop)
      errors.add('extra_stop')
    }
  }

  for (let dayIndex = 0; dayIndex < gold.days.length; dayIndex += 1) {
    if (matchedGoldDays.has(dayIndex)) continue

    const day = gold.days[dayIndex]
    if (day) addMissedGoldDay(fieldCounts, day)
    errors.add('missing_day')
  }

  for (let dayIndex = 0; dayIndex < predicted.days.length; dayIndex += 1) {
    if (matchedPredictedDays.has(dayIndex)) continue

    const day = predicted.days[dayIndex]
    if (day) addExtraPredictedDay(fieldCounts, day)
    errors.add('extra_day')
  }

  return {
    fieldCounts,
    dayCount: {
      gold: gold.days.length,
      predicted: predicted.days.length,
      matched: dayPairs.length,
    },
    stopCount: {
      gold: gold.days.reduce((count, day) => count + day.stops.length, 0),
      predicted: predicted.days.reduce((count, day) => count + day.stops.length, 0),
      matched: matchedStops,
    },
    errors,
  }
}

function missedCase(
  testCase: ExtractionF1Case,
  gold: ExtractedPlan,
  error: 'provider' | 'schema',
  details: {
    providerError?: string
    schemaIssues?: ExtractionF1CaseResult['schemaIssues']
  },
): ExtractionF1CaseResult {
  const fieldCounts = emptyFieldCounts()

  for (const day of gold.days) {
    addMissedGoldDay(fieldCounts, day)
  }

  return {
    id: testCase.id,
    format: testCase.format,
    schemaValid: false,
    noInvention: false,
    providerError: details.providerError ?? null,
    dayCount: {
      gold: gold.days.length,
      predicted: 0,
      matched: 0,
    },
    stopCount: {
      gold: gold.days.reduce((count, day) => count + day.stops.length, 0),
      predicted: 0,
      matched: 0,
    },
    fieldCounts,
    schemaIssues: details.schemaIssues ?? [],
    inventions: [],
    errors: [error],
  }
}

export function scoreExtractionCase(
  testCase: ExtractionF1Case,
  gold: ExtractedPlan,
  raw: unknown,
  providerError: string | null = null,
): ExtractionF1CaseResult {
  if (providerError !== null) {
    return missedCase(testCase, gold, 'provider', { providerError })
  }

  const validation = validateExtraction(testCase.text, raw)

  if (!validation.ok && validation.stage === 'schema') {
    return missedCase(testCase, gold, 'schema', {
      schemaIssues: validation.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }

  const comparison = comparePlans(gold, validation.plan)
  const errors = new Set(comparison.errors)

  if (!validation.ok) {
    errors.add('invention')
  }

  return {
    id: testCase.id,
    format: testCase.format,
    schemaValid: true,
    noInvention: validation.ok,
    providerError: null,
    dayCount: comparison.dayCount,
    stopCount: comparison.stopCount,
    fieldCounts: comparison.fieldCounts,
    schemaIssues: [],
    inventions: validation.ok ? [] : validation.inventions,
    errors: [...errors],
  }
}

function scoreFields(fieldCounts: Record<F1Field, FieldCounts>): Record<F1Field, FieldScore> {
  return Object.fromEntries(
    F1_FIELDS.map((field) => {
      const counts = fieldCounts[field]
      const precision = counts.tp + counts.fp > 0 ? counts.tp / (counts.tp + counts.fp) : 0
      const recall = counts.tp + counts.fn > 0 ? counts.tp / (counts.tp + counts.fn) : 0
      const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

      return [field, { ...counts, precision, recall, f1 }]
    }),
  ) as Record<F1Field, FieldScore>
}

function macroF1(fieldScores: Record<F1Field, FieldScore>): number {
  const activeFields = F1_FIELDS.filter((field) => {
    const counts = fieldScores[field]
    return counts.tp + counts.fp + counts.fn > 0
  })

  if (activeFields.length === 0) return 0

  return (
    activeFields.reduce((total, field) => total + fieldScores[field].f1, 0) / activeFields.length
  )
}

function microF1(fieldCounts: Record<F1Field, FieldCounts>): number {
  let tp = 0
  let fp = 0
  let fn = 0

  for (const field of F1_FIELDS) {
    tp += fieldCounts[field].tp
    fp += fieldCounts[field].fp
    fn += fieldCounts[field].fn
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0

  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
}

function emptyFieldCountsRecord(): Record<F1Field, FieldCounts> {
  return emptyFieldCounts()
}

function sumFieldCounts(results: ExtractionF1CaseResult[]): Record<F1Field, FieldCounts> {
  const total = emptyFieldCountsRecord()

  for (const result of results) {
    for (const field of F1_FIELDS) {
      total[field].tp += result.fieldCounts[field].tp
      total[field].fp += result.fieldCounts[field].fp
      total[field].fn += result.fieldCounts[field].fn
    }
  }

  return total
}

function sumCounts(
  results: ExtractionF1CaseResult[],
  key: 'dayCount' | 'stopCount',
): { gold: number; predicted: number; matched: number } {
  return results.reduce(
    (total, result) => ({
      gold: total.gold + result[key].gold,
      predicted: total.predicted + result[key].predicted,
      matched: total.matched + result[key].matched,
    }),
    { gold: 0, predicted: 0, matched: 0 },
  )
}

function buildFormatReport(
  results: ExtractionF1CaseResult[],
): ExtractionF1Report['byFormat'][ExtractionF1Format] {
  const fieldCounts = sumFieldCounts(results)
  const fieldScores = scoreFields(fieldCounts)

  return {
    total: results.length,
    schemaValidCount: results.filter((result) => result.schemaValid).length,
    noInventionCount: results.filter((result) => result.noInvention).length,
    macroF1: macroF1(fieldScores),
    microF1: microF1(fieldCounts),
    fieldScores,
  }
}

function assertCasesFile(value: unknown): asserts value is CasesFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Fichier de corpus d’extraction F1 invalide.')
  }

  const file = value as Partial<CasesFile>

  if (!Array.isArray(file.cases) || file.cases.length !== 30) {
    throw new Error('30 cas d’extraction F1 attendus.')
  }

  if (
    !Array.isArray(file.formats) ||
    file.formats.length !== EXTRACTION_F1_FORMATS.length ||
    !EXTRACTION_F1_FORMATS.every((format) => file.formats?.includes(format))
  ) {
    throw new Error('Trois formats d’extraction F1 attendus.')
  }

  if (
    !file.thresholds ||
    typeof file.thresholds.schemaValid !== 'number' ||
    typeof file.thresholds.noInvention !== 'number'
  ) {
    throw new Error('Seuils d’extraction F1 manquants.')
  }

  const ids = new Set<string>()

  for (const testCase of file.cases) {
    if (
      !testCase ||
      typeof testCase.id !== 'string' ||
      testCase.id === '' ||
      !EXTRACTION_F1_FORMATS.includes(testCase.format) ||
      typeof testCase.text !== 'string' ||
      testCase.text.trim() === ''
    ) {
      throw new Error('Cas d’extraction F1 invalide.')
    }

    if (ids.has(testCase.id)) {
      throw new Error(`Cas d’extraction F1 dupliqué : ${testCase.id}`)
    }

    ids.add(testCase.id)
  }

  for (const format of EXTRACTION_F1_FORMATS) {
    const count = file.cases.filter((testCase) => testCase.format === format).length

    if (count !== 10) {
      throw new Error(`10 cas attendus pour le format ${format}.`)
    }
  }
}

function assertGoldFile(value: unknown, cases: ExtractionF1Case[]): asserts value is GoldFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Fichier d’annotations d’extraction F1 invalide.')
  }

  const file = value as Partial<GoldFile>

  if (!file.cases || typeof file.cases !== 'object' || Array.isArray(file.cases)) {
    throw new Error('Annotations d’extraction F1 manquantes.')
  }

  for (const testCase of cases) {
    const rawPlan = file.cases[testCase.id]

    if (rawPlan === undefined) {
      throw new Error(`Annotation manquante pour ${testCase.id}.`)
    }

    const parsed = ExtractedPlanSchema.safeParse(rawPlan)

    if (!parsed.success) {
      throw new Error(`Annotation invalide pour ${testCase.id}.`)
    }

    const inventions = findInventions(testCase.text, parsed.data)

    if (inventions.length > 0) {
      throw new Error(
        `Annotation inventée pour ${testCase.id} : ${inventions
          .map((invention) => `${invention.path}=${invention.value}`)
          .join(', ')}`,
      )
    }
  }
}

export async function loadExtractionF1Corpus(): Promise<{
  cases: CasesFile
  gold: GoldFile
}> {
  const cases = JSON.parse(await readFile(casesPath, 'utf8')) as unknown
  assertCasesFile(cases)

  const gold = JSON.parse(await readFile(goldPath, 'utf8')) as unknown
  assertGoldFile(gold, cases.cases)

  return { cases, gold }
}

function assertRecordedFile(
  value: unknown,
  cases: ExtractionF1Case[],
): asserts value is RecordedFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Fichier de sorties d’extraction F1 invalide.')
  }

  const file = value as Partial<RecordedFile>

  if (!file.outputs || typeof file.outputs !== 'object' || Array.isArray(file.outputs)) {
    throw new Error('Sorties d’extraction F1 manquantes.')
  }

  for (const testCase of cases) {
    const output = file.outputs[testCase.id]

    if (!output || typeof output !== 'object' || !('ok' in output)) {
      throw new Error(`Sortie manquante pour ${testCase.id}.`)
    }

    if (output.ok === false && typeof output.error !== 'string') {
      throw new Error(`Erreur de sortie invalide pour ${testCase.id}.`)
    }
  }
}

export async function readExtractionF1Recorded(): Promise<RecordedFile> {
  const raw = JSON.parse(
    await readFile(join(repoRoot, 'evals', 'extraction-f1', 'recorded.json'), 'utf8'),
  ) as unknown
  const cases = JSON.parse(await readFile(casesPath, 'utf8')) as unknown
  assertCasesFile(cases)
  assertRecordedFile(raw, cases.cases)
  return raw
}

export async function collectExtractionF1Outputs(
  cases: ExtractionF1Case[],
  client: ExtractionClient,
): Promise<Record<string, RecordedOutput>> {
  const outputs: Record<string, RecordedOutput> = {}

  for (const testCase of cases) {
    try {
      outputs[testCase.id] = {
        ok: true,
        output: await client.extract(testCase.text),
      }
    } catch (error) {
      outputs[testCase.id] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return outputs
}

export async function runExtractionF1Eval(options: {
  mode: 'recorded' | 'live'
  source: string | null
  outputs: Record<string, RecordedOutput>
}): Promise<ExtractionF1Report> {
  const { cases, gold } = await loadExtractionF1Corpus()
  const results: ExtractionF1CaseResult[] = []

  for (const testCase of cases.cases) {
    const recorded = options.outputs[testCase.id]

    if (!recorded) {
      throw new Error(`Sortie manquante pour ${testCase.id}.`)
    }

    const goldPlan = gold.cases[testCase.id]

    if (!goldPlan) {
      throw new Error(`Annotation manquante pour ${testCase.id}.`)
    }

    results.push(
      recorded.ok
        ? scoreExtractionCase(testCase, goldPlan, recorded.output)
        : scoreExtractionCase(testCase, goldPlan, null, recorded.error),
    )
  }

  const fieldCounts = sumFieldCounts(results)
  const fieldScores = scoreFields(fieldCounts)
  const errors = results.filter((result) => result.errors.length > 0)
  const formats = Object.fromEntries(
    EXTRACTION_F1_FORMATS.map((format) => [
      format,
      cases.cases.filter((testCase) => testCase.format === format).length,
    ]),
  ) as Record<ExtractionF1Format, number>
  const byFormat = Object.fromEntries(
    EXTRACTION_F1_FORMATS.map((format) => [
      format,
      buildFormatReport(results.filter((result) => result.format === format)),
    ]),
  ) as ExtractionF1Report['byFormat']
  const errorSummary = Object.fromEntries(
    F1_ERROR_CATEGORIES.map((category) => [
      category,
      results.filter((result) => result.errors.includes(category)).length,
    ]),
  ) as Record<F1ErrorCategory, number>

  return {
    version: 1,
    measuredAt: new Date().toISOString(),
    mode: options.mode,
    source: options.source,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    corpus: {
      total: cases.cases.length,
      formats,
      goldSource: gold.source,
    },
    thresholds: cases.thresholds,
    metrics: {
      total: results.length,
      schemaValidCount: results.filter((result) => result.schemaValid).length,
      noInventionCount: results.filter((result) => result.noInvention).length,
      schemaValid:
        results.length > 0
          ? results.filter((result) => result.schemaValid).length / results.length
          : 0,
      noInvention:
        results.length > 0
          ? results.filter((result) => result.noInvention).length / results.length
          : 0,
      exactPlanCount: results.filter((result) => result.errors.length === 0).length,
      dayCount: sumCounts(results, 'dayCount'),
      stopCount: sumCounts(results, 'stopCount'),
      fieldScores,
      macroF1: macroF1(fieldScores),
      microF1: microF1(fieldCounts),
    },
    byFormat,
    errorSummary,
    errors,
    cases: results,
  }
}
