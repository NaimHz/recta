import {
  ISSUE_CODES,
  IsoDateSchema,
  IssueCodeSchema,
  IssueSeveritySchema,
  UndeterminedSchema,
  type IssueCode,
  type IssueSeverity,
  type NormalizedPlan,
  type VerificationResult,
} from '@recta/domain'
import { z } from 'zod'

const IdSchema = z.string().min(1)

export const GOLD_KINDS = ['planted', 'real'] as const
export type GoldKind = (typeof GOLD_KINDS)[number]

export const NONE = 'aucun'
type MatrixLabel = IssueCode | typeof NONE
const MATRIX_LABELS: MatrixLabel[] = [...ISSUE_CODES, NONE]

export const GoldPlanMetaSchema = z.strictObject({
  id: IdSchema,
  kind: z.enum(GOLD_KINDS),
  cityId: IdSchema,
  start: IsoDateSchema.nullable(),
  model: z.string().min(1).nullable(),
  collectedAt: IsoDateSchema.nullable(),
  promptId: IdSchema.nullable(),
})

export type GoldPlanMeta = z.infer<typeof GoldPlanMetaSchema>

const AnnotationStopSchema = z.strictObject({
  id: IdSchema,
  day: IdSchema,
  name: z.string().min(1),
  sourceText: z.string().min(1),
  start: z.string().nullable(),
  end: z.string().nullable(),
})

const AnnotationEvidenceSchema = z.strictObject({
  source: z.string().min(1),
  url: z.url().nullable(),
  sourceDate: IsoDateSchema.nullable().default(null),
  raw: z.string().min(1),
})

const AnnotatedIssueSchema = z.strictObject({
  code: IssueCodeSchema,
  severity: IssueSeveritySchema,
  stopIds: z.array(IdSchema).min(1),
  evidence: z.array(AnnotationEvidenceSchema).min(1),
})

const KeySchema = z.strictObject({
  code: IssueCodeSchema,
  stopIds: z.array(IdSchema).min(1),
})

export const GoldAnnotationSchema = z
  .strictObject({
    plan: IdSchema,
    pass: z.number().int().positive(),
    annotatedAt: IsoDateSchema.nullable(),
    minutes: z.number().nonnegative().nullable(),
    stops: z.array(AnnotationStopSchema).min(1),
    issues: z.array(AnnotatedIssueSchema),
    undetermined: z.array(UndeterminedSchema),
    planted: z.array(KeySchema),
  })
  .superRefine((annotation, context) => {
    const known = new Set(annotation.stops.map((stop) => stop.id))
    const entries = [
      ...annotation.issues.map((issue, index) => ['issues', index, issue.stopIds] as const),
      ...annotation.undetermined.map(
        (entry, index) => ['undetermined', index, entry.stopIds] as const,
      ),
      ...annotation.planted.map((entry, index) => ['planted', index, entry.stopIds] as const),
    ]

    for (const [field, index, stopIds] of entries) {
      for (const stopId of stopIds) {
        if (!known.has(stopId)) {
          context.addIssue({
            code: 'custom',
            path: [field, index, 'stopIds'],
            message: `Stop inconnu : ${stopId}`,
          })
        }
      }
    }

    const annotatedKeys = new Set(
      annotation.issues.map((issue) => keyOf(issue.code, issue.stopIds)),
    )

    annotation.planted.forEach((entry, index) => {
      if (!annotatedKeys.has(keyOf(entry.code, entry.stopIds))) {
        context.addIssue({
          code: 'custom',
          path: ['planted', index],
          message: 'Clé plantée absente des issues annotées',
        })
      }
    })
  })

export type GoldAnnotation = z.infer<typeof GoldAnnotationSchema>

export type GoldPlanInput = {
  meta: GoldPlanMeta
  annotation: GoldAnnotation
  result: Pick<VerificationResult, 'issues' | 'undetermined' | 'checks'>
}

export type CodeScore = {
  tp: number
  fp: number
  fn: number
  fnAbstention: number
  fpOnUndetermined: number
  precision: number | null
  recall: number | null
  f1: number | null
}

export type GoldPlanDetail = {
  id: string
  kind: GoldKind
  tp: string[]
  fp: string[]
  fn: string[]
  fnAbstention: string[]
  fpOnUndetermined: string[]
}

export type GoldKindReport = {
  plans: number
  annotatedKeys: Record<IssueCode, number>
  matrix: Record<MatrixLabel, Record<MatrixLabel, number>>
  perCode: Record<IssueCode, CodeScore>
  macroF1: number | null
  micro: CodeScore
  severityAgreement: { same: number; tp: number; ratio: number | null }
  coverage: Record<IssueCode, { executed: number; undetermined: number; ratio: number | null }>
  plansWithError: { annotated: number; system: number }
  details: GoldPlanDetail[]
}

export type GoldReport = {
  version: 1
  matrixFilled: boolean
  missingCodes: IssueCode[]
  kinds: Record<GoldKind, GoldKindReport>
}

export function keyOf(code: IssueCode, stopIds: readonly string[]): string {
  return `${code}:${[...new Set(stopIds)].sort().join(',')}`
}

function stopsOf(key: string): string {
  return key.slice(key.indexOf(':') + 1)
}

function codeOf(key: string): IssueCode {
  return key.slice(0, key.indexOf(':')) as IssueCode
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round3(numerator / denominator)
}

function score(counts: Omit<CodeScore, 'precision' | 'recall' | 'f1'>): CodeScore {
  const precision = ratio(counts.tp, counts.tp + counts.fp)
  const recall = ratio(counts.tp, counts.tp + counts.fn)
  const f1 = ratio(2 * counts.tp, 2 * counts.tp + counts.fp + counts.fn)

  return { ...counts, precision, recall, f1 }
}

function byCode<T>(build: (code: IssueCode) => T): Record<IssueCode, T> {
  return Object.fromEntries(ISSUE_CODES.map((code) => [code, build(code)])) as Record<IssueCode, T>
}

function emptyMatrix(): Record<MatrixLabel, Record<MatrixLabel, number>> {
  return Object.fromEntries(
    MATRIX_LABELS.map((row) => [row, Object.fromEntries(MATRIX_LABELS.map((col) => [col, 0]))]),
  ) as Record<MatrixLabel, Record<MatrixLabel, number>>
}

function codeOrder(left: IssueCode, right: IssueCode): number {
  return ISSUE_CODES.indexOf(left) - ISSUE_CODES.indexOf(right)
}

function fillMatrix(
  matrix: Record<MatrixLabel, Record<MatrixLabel, number>>,
  annotated: ReadonlySet<string>,
  emitted: ReadonlySet<string>,
): void {
  const groups = new Map<string, { annotated: IssueCode[]; emitted: IssueCode[] }>()
  const group = (key: string) => {
    const stops = stopsOf(key)
    const entry = groups.get(stops) ?? { annotated: [], emitted: [] }

    groups.set(stops, entry)
    return entry
  }

  for (const key of annotated) group(key).annotated.push(codeOf(key))
  for (const key of emitted) group(key).emitted.push(codeOf(key))

  for (const entry of groups.values()) {
    const both = entry.annotated.filter((code) => entry.emitted.includes(code))
    const onlyAnnotated = entry.annotated.filter((code) => !both.includes(code)).sort(codeOrder)
    const onlyEmitted = entry.emitted.filter((code) => !both.includes(code)).sort(codeOrder)

    for (const code of both) matrix[code][code] += 1

    const paired = Math.min(onlyAnnotated.length, onlyEmitted.length)

    for (let index = 0; index < paired; index += 1) {
      matrix[onlyAnnotated[index] as IssueCode][onlyEmitted[index] as IssueCode] += 1
    }

    for (const code of onlyAnnotated.slice(paired)) matrix[code][NONE] += 1
    for (const code of onlyEmitted.slice(paired)) matrix[NONE][code] += 1
  }
}

function scoreKind(plans: readonly GoldPlanInput[]): GoldKindReport {
  const counts = byCode(() => ({ tp: 0, fp: 0, fn: 0, fnAbstention: 0, fpOnUndetermined: 0 }))
  const annotatedKeys = byCode(() => 0)
  const coverage = byCode(() => ({ executed: 0, undetermined: 0 }))
  const matrix = emptyMatrix()
  const severity = { same: 0, tp: 0 }
  const plansWithError = { annotated: 0, system: 0 }
  const details: GoldPlanDetail[] = []

  for (const { meta, annotation, result } of plans) {
    const annotatedSeverity = new Map<string, IssueSeverity>()

    for (const issue of annotation.issues) {
      annotatedSeverity.set(keyOf(issue.code, issue.stopIds), issue.severity)
    }

    const annotatedUndetermined = new Set(
      annotation.undetermined.flatMap((entry) =>
        entry.codes.map((code) => keyOf(code, entry.stopIds)),
      ),
    )
    const emittedSeverity = new Map<string, IssueSeverity>()

    for (const issue of result.issues) {
      emittedSeverity.set(keyOf(issue.code, issue.stopIds), issue.severity)
    }

    const systemUndetermined = new Set(
      result.undetermined.flatMap((entry) => entry.codes.map((code) => keyOf(code, entry.stopIds))),
    )
    const detail: GoldPlanDetail = {
      id: meta.id,
      kind: meta.kind,
      tp: [],
      fp: [],
      fn: [],
      fnAbstention: [],
      fpOnUndetermined: [],
    }

    for (const [key, annotatedLevel] of annotatedSeverity) {
      const code = codeOf(key)
      const emittedLevel = emittedSeverity.get(key)

      annotatedKeys[code] += 1

      if (emittedLevel !== undefined) {
        counts[code].tp += 1
        detail.tp.push(key)
        severity.tp += 1
        if (emittedLevel === annotatedLevel) severity.same += 1
      } else {
        counts[code].fn += 1
        detail.fn.push(key)

        if (systemUndetermined.has(key)) {
          counts[code].fnAbstention += 1
          detail.fnAbstention.push(key)
        }
      }
    }

    for (const key of emittedSeverity.keys()) {
      if (annotatedSeverity.has(key)) continue

      const code = codeOf(key)

      counts[code].fp += 1
      detail.fp.push(key)

      if (annotatedUndetermined.has(key)) {
        counts[code].fpOnUndetermined += 1
        detail.fpOnUndetermined.push(key)
      }
    }

    fillMatrix(
      matrix,
      new Set(annotatedSeverity.keys()),
      new Set([...emittedSeverity.keys()].filter((key) => !annotatedUndetermined.has(key))),
    )

    for (const check of result.checks) {
      coverage[check.code].executed += check.executed
      coverage[check.code].undetermined += check.undetermined
    }

    if (annotation.issues.some((issue) => issue.severity === 'error')) plansWithError.annotated += 1
    if (result.issues.some((issue) => issue.severity === 'error')) plansWithError.system += 1

    details.push(detail)
  }

  const perCode = byCode((code) => score(counts[code]))
  const scored = ISSUE_CODES.map((code) => perCode[code]).filter(
    (entry) => entry.tp + entry.fp + entry.fn > 0,
  )
  const f1Values = scored.map((entry) => entry.f1 ?? 0)
  const total = ISSUE_CODES.reduce(
    (sum, code) => ({
      tp: sum.tp + counts[code].tp,
      fp: sum.fp + counts[code].fp,
      fn: sum.fn + counts[code].fn,
      fnAbstention: sum.fnAbstention + counts[code].fnAbstention,
      fpOnUndetermined: sum.fpOnUndetermined + counts[code].fpOnUndetermined,
    }),
    { tp: 0, fp: 0, fn: 0, fnAbstention: 0, fpOnUndetermined: 0 },
  )

  return {
    plans: plans.length,
    annotatedKeys,
    matrix,
    perCode,
    macroF1:
      f1Values.length === 0
        ? null
        : round3(f1Values.reduce((sum, value) => sum + value, 0) / f1Values.length),
    micro: score(total),
    severityAgreement: { ...severity, ratio: ratio(severity.same, severity.tp) },
    coverage: byCode((code) => ({
      ...coverage[code],
      ratio:
        coverage[code].executed === 0
          ? null
          : round3(1 - coverage[code].undetermined / coverage[code].executed),
    })),
    plansWithError,
    details,
  }
}

export function scoreGoldSet(plans: readonly GoldPlanInput[]): GoldReport {
  const kinds = Object.fromEntries(
    GOLD_KINDS.map((kind) => [kind, scoreKind(plans.filter((plan) => plan.meta.kind === kind))]),
  ) as Record<GoldKind, GoldKindReport>
  const missingCodes = ISSUE_CODES.filter(
    (code) => kinds.planted.annotatedKeys[code] + kinds.real.annotatedKeys[code] === 0,
  )

  return { version: 1, matrixFilled: missingCodes.length === 0, missingCodes, kinds }
}

export function annotationStops(plan: NormalizedPlan): GoldAnnotation['stops'] {
  let index = 0

  return plan.days.flatMap((day, dayIndex) =>
    day.stops.map((stop) => {
      index += 1

      return {
        id: `stop-${index}`,
        day: `day-${dayIndex + 1}`,
        name: stop.name,
        sourceText: stop.sourceText,
        start: stop.start,
        end: stop.end,
      }
    }),
  )
}
