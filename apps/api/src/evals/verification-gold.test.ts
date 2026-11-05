import { describe, expect, it } from 'vitest'
import type { Issue, IssueCode, IssueSeverity, Undetermined } from '@recta/domain'
import {
  GoldAnnotationSchema,
  NONE,
  scoreGoldSet,
  type GoldAnnotation,
  type GoldKind,
  type GoldPlanInput,
} from './verification-gold-eval'

const STOP_IDS = Array.from({ length: 8 }, (_, index) => `stop-${index + 1}`)

function annotated(code: IssueCode, stopIds: string[], severity: IssueSeverity = 'error') {
  return {
    code,
    severity,
    stopIds,
    evidence: [{ source: 'osm', url: null, sourceDate: null, raw: 'Mo-Fr 10:00-18:00' }],
  }
}

function emitted(code: IssueCode, stopIds: string[], severity: IssueSeverity = 'error'): Issue {
  return {
    id: `${code}:${stopIds.join(',')}`,
    code,
    severity,
    message: 'message',
    stopIds,
    evidence: [
      {
        source: 'osm',
        sourceDate: null,
        retrievedAt: null,
        url: null,
        attribution: null,
        raw: 'raw',
        fields: {},
      },
    ],
  }
}

function plan(
  id: string,
  annotation: Partial<Pick<GoldAnnotation, 'issues' | 'undetermined' | 'planted'>>,
  result: { issues?: Issue[]; undetermined?: Undetermined[] } = {},
  kind: GoldKind = 'real',
): GoldPlanInput {
  return {
    meta: {
      id,
      kind,
      cityId: 'paris',
      start: '2026-11-16',
      model: null,
      collectedAt: null,
      promptId: null,
    },
    annotation: {
      plan: id,
      pass: 1,
      annotatedAt: null,
      minutes: null,
      stops: STOP_IDS.map((stopId) => ({
        id: stopId,
        day: 'day-1',
        name: stopId,
        sourceText: stopId,
        start: null,
        end: null,
      })),
      issues: annotation.issues ?? [],
      undetermined: annotation.undetermined ?? [],
      planted: annotation.planted ?? [],
    },
    result: {
      issues: result.issues ?? [],
      undetermined: result.undetermined ?? [],
      checks: [],
    },
  }
}

describe('scoreGoldSet', () => {
  it('reproduit l’exemple de METRICS : P 0,714, R 0,833, F1 0,769', () => {
    const code = 'outside_opening_hours'
    const report = scoreGoldSet([
      plan(
        'real-001',
        {
          issues: STOP_IDS.slice(0, 6).map((stopId) => annotated(code, [stopId])),
          undetermined: [{ codes: [code], stopIds: ['stop-8'], reason: 'missing_hours' }],
        },
        {
          issues: [...STOP_IDS.slice(0, 5), 'stop-7', 'stop-8'].map((stopId) =>
            emitted(code, [stopId]),
          ),
        },
      ),
    ])
    const score = report.kinds.real.perCode[code]

    expect(score).toMatchObject({ tp: 5, fp: 2, fn: 1, fpOnUndetermined: 1 })
    expect([score.precision, score.recall, score.f1]).toEqual([0.714, 0.833, 0.769])
  })

  it('apparie la diagonale, puis les confusions dans l’ordre des codes, puis le reliquat', () => {
    const report = scoreGoldSet([
      plan(
        'real-001',
        {
          issues: [
            annotated('stop_overlap', ['stop-1', 'stop-2']),
            annotated('holiday_closure', ['stop-3']),
            annotated('after_last_entry', ['stop-4']),
          ],
        },
        {
          issues: [
            emitted('stop_overlap', ['stop-2', 'stop-1']),
            emitted('place_closed_day', ['stop-3']),
            emitted('overloaded_day', ['stop-5']),
          ],
        },
      ),
    ])
    const { matrix } = report.kinds.real

    expect(matrix.stop_overlap.stop_overlap).toBe(1)
    expect(matrix.holiday_closure.place_closed_day).toBe(1)
    expect(matrix.after_last_entry[NONE]).toBe(1)
    expect(matrix[NONE].overloaded_day).toBe(1)
  })

  it('distingue l’abstention de l’erreur manquée', () => {
    const report = scoreGoldSet([
      plan(
        'real-001',
        {
          issues: [
            annotated('place_closed_day', ['stop-1']),
            annotated('place_closed_day', ['stop-2']),
          ],
        },
        {
          undetermined: [
            { codes: ['place_closed_day'], stopIds: ['stop-1'], reason: 'missing_hours' },
          ],
        },
      ),
    ])

    expect(report.kinds.real.perCode.place_closed_day).toMatchObject({ fn: 2, fnAbstention: 1 })
    expect(report.kinds.real.details[0]?.fnAbstention).toEqual(['place_closed_day:stop-1'])
  })

  it('sort de la matrice une issue émise sur une clé annotée indéterminée', () => {
    const report = scoreGoldSet([
      plan(
        'real-001',
        { undetermined: [{ codes: ['holiday_closure'], stopIds: ['stop-1'], reason: 'unknown' }] },
        { issues: [emitted('holiday_closure', ['stop-1'])] },
      ),
    ])

    expect(report.kinds.real.perCode.holiday_closure).toMatchObject({ fp: 1, fpOnUndetermined: 1 })
    expect(report.kinds.real.matrix[NONE].holiday_closure).toBe(0)
  })

  it('mesure l’accord de sévérité sur les TP', () => {
    const report = scoreGoldSet([
      plan(
        'real-001',
        {
          issues: [
            annotated('stop_overlap', ['stop-1', 'stop-2'], 'error'),
            annotated('insufficient_buffer', ['stop-2', 'stop-3'], 'warning'),
          ],
        },
        {
          issues: [
            emitted('stop_overlap', ['stop-1', 'stop-2'], 'error'),
            emitted('insufficient_buffer', ['stop-2', 'stop-3'], 'info'),
          ],
        },
      ),
    ])

    expect(report.kinds.real.severityAgreement).toEqual({ same: 1, tp: 2, ratio: 0.5 })
  })

  it('sépare les plans plantés des plans réels et signale les codes jamais annotés', () => {
    const report = scoreGoldSet([
      plan(
        'planted-001',
        { issues: [annotated('place_closed_day', ['stop-1'])] },
        { issues: [emitted('place_closed_day', ['stop-1'])] },
        'planted',
      ),
      plan('real-001', { issues: [annotated('overloaded_day', STOP_IDS, 'warning')] }),
    ])

    expect(report.kinds.planted.plans).toBe(1)
    expect(report.kinds.planted.perCode.place_closed_day.tp).toBe(1)
    expect(report.kinds.real.perCode.overloaded_day.fn).toBe(1)
    expect(report.kinds.planted.plansWithError).toEqual({ annotated: 1, system: 1 })
    expect(report.kinds.real.plansWithError).toEqual({ annotated: 0, system: 0 })
    expect(report.matrixFilled).toBe(false)
    expect(report.missingCodes).not.toContain('overloaded_day')
    expect(report.missingCodes).toContain('last_departure_missed')
  })
})

describe('GoldAnnotationSchema', () => {
  const base = plan('real-001', {}).annotation

  it('refuse un stop inconnu', () => {
    const result = GoldAnnotationSchema.safeParse({
      ...base,
      issues: [annotated('place_closed_day', ['stop-99'])],
    })

    expect(result.success).toBe(false)
  })

  it('refuse une issue sans preuve', () => {
    const result = GoldAnnotationSchema.safeParse({
      ...base,
      issues: [{ ...annotated('place_closed_day', ['stop-1']), evidence: [] }],
    })

    expect(result.success).toBe(false)
  })

  it('refuse une clé plantée absente des issues annotées', () => {
    const result = GoldAnnotationSchema.safeParse({
      ...base,
      planted: [{ code: 'place_closed_day', stopIds: ['stop-1'] }],
    })

    expect(result.success).toBe(false)
  })
})
