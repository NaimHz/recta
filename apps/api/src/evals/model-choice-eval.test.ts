import { describe, expect, it } from 'vitest'
import { ExtractionProviderError } from '../extraction/anthropic'
import type { ExtractionF1Case, ExtractionF1Report, RecordedOutput } from './extraction-f1-eval'
import {
  MODEL_CHOICE_RULES,
  buildModelChoiceReport,
  callCostUsd,
  collectModelChoice,
  nearestRankPercentile,
  type ModelChoiceCall,
  type ModelChoiceConfig,
  type ModelChoiceRecorded,
} from './model-choice-eval'

const cases: ExtractionF1Case[] = [
  { id: 'a', format: 'whatsapp', text: 'A' },
  { id: 'b', format: 'email', text: 'B' },
]

const haiku: ModelChoiceConfig = { id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low' }
const sonnet: ModelChoiceConfig = { id: 'sonnet-low', model: 'claude-sonnet-5-5', effort: 'low' }

function okCall(latencyMs: number, outputTokens = 200): ModelChoiceCall {
  return {
    ok: true,
    output: { days: [] },
    inputTokens: 1000,
    outputTokens,
    stopReason: 'end_turn',
    latencyMs,
  }
}

function recordedFor(
  configs: Array<ModelChoiceConfig & { latencyMs?: number }>,
): ModelChoiceRecorded {
  return {
    version: 1,
    promptVersion: 'extraction-v4',
    measuredAt: '2026-11-03T10:00:00.000Z',
    prices: {},
    pricesSource: {
      url: 'https://platform.claude.com/docs/en/about-claude/pricing',
      checkedAt: '2026-10-06',
      currency: 'USD',
    },
    rules: MODEL_CHOICE_RULES,
    stopped: null,
    configs: configs.map(({ latencyMs = 1000, ...config }) => ({
      ...config,
      warmup: okCall(latencyMs),
      repetitions: Array.from({ length: MODEL_CHOICE_RULES.repetitions }, () => ({
        a: okCall(latencyMs),
        b: okCall(latencyMs),
      })),
    })),
  }
}

function fakeScore(byModel: Record<string, Partial<ExtractionF1Report['metrics']>>) {
  let call = 0
  const order: string[] = []

  return {
    order,
    score: async (_outputs: Record<string, RecordedOutput>): Promise<ExtractionF1Report> => {
      const model = order[call] ?? ''
      call += 1

      return {
        metrics: {
          schemaValidCount: 2,
          noInventionCount: 2,
          macroF1: 0.98,
          microF1: 0.97,
          fieldScores: { type: { f1: 0.9 } },
          ...byModel[model],
        },
        errorSummary: { provider: 0 },
      } as unknown as ExtractionF1Report
    },
  }
}

describe('callCostUsd', () => {
  it('applique les prix par million de tokens', () => {
    expect(callCostUsd('claude-haiku-5-5', 1_000_000, 1_000_000)).toBeCloseTo(0.6, 10)
    expect(callCostUsd('claude-sonnet-5-5', 1500, 400)).toBeCloseTo(0.007, 10)
  })

  it('refuse un modèle sans prix', () => {
    expect(() => callCostUsd('modele-inconnu', 1, 1)).toThrow(/Prix inconnu/)
  })
})

describe('nearestRankPercentile', () => {
  it('prend la valeur au rang le plus proche', () => {
    const values = [900, 110, 120, 130, 140, 150, 160, 180, 200, 400]

    expect(nearestRankPercentile(values, 0.5)).toBe(150)
    expect(nearestRankPercentile(values, 0.95)).toBe(900)
    expect(nearestRankPercentile([], 0.5)).toBeNull()
  })
})

describe('buildModelChoiceReport', () => {
  it('retient la configuration éligible la moins chère', async () => {
    const recorded = recordedFor([sonnet, haiku])
    const { order, score } = fakeScore({})
    order.push('sonnet', 'sonnet', 'haiku', 'haiku')

    const report = await buildModelChoiceReport(recorded, cases, score)

    expect(report.configs.every((config) => config.eligible)).toBe(true)
    expect(report.selected).toBe('haiku-low')
    expect(report.configs[1]?.meanCostUsd).toBeCloseTo(0.0002, 10)
    expect(report.configs[1]?.latency).toEqual({ samples: 4, p50Ms: 1000, p95Ms: 1000 })
  })

  it('exclut une configuration sous la marge de F1 ou avec une invention', async () => {
    const recorded = recordedFor([sonnet, haiku])
    const { order, score } = fakeScore({
      sonnet: { macroF1: 0.99 },
      haiku: { macroF1: 0.96, noInventionCount: 1 },
    })
    order.push('sonnet', 'sonnet', 'haiku', 'haiku')

    const report = await buildModelChoiceReport(recorded, cases, score)
    const haikuReport = report.configs.find((config) => config.id === 'haiku-low')

    expect(report.bestMacroF1).toBeCloseTo(0.99, 10)
    expect(haikuReport?.eligible).toBe(false)
    expect(haikuReport?.reasons).toContain('répétition 1 : sans invention 1/2')
    expect(haikuReport?.reasons.some((reason) => reason.includes('F1 macro 0.960'))).toBe(true)
    expect(report.selected).toBe('sonnet-low')
  })

  it('exclut une configuration trop lente', async () => {
    const recorded = recordedFor([{ ...haiku, latencyMs: 12_000 }])
    const { order, score } = fakeScore({})
    order.push('haiku', 'haiku')

    const report = await buildModelChoiceReport(recorded, cases, score)

    expect(report.selected).toBeNull()
    expect(report.configs[0]?.reasons).toContain('latence p95 12000 ms > 10000 ms')
  })

  it('exclut une mesure incomplète', async () => {
    const recorded = recordedFor([haiku])
    recorded.configs[0]?.repetitions.pop()

    const report = await buildModelChoiceReport(recorded, cases, fakeScore({}).score)

    expect(report.configs[0]?.complete).toBe(false)
    expect(report.configs[0]?.reasons).toContain('mesure incomplète')
  })
})

describe('collectModelChoice', () => {
  it('préchauffe, répète et enregistre les tokens des erreurs fournisseur', async () => {
    let calls = 0
    const recorded = await collectModelChoice({
      cases,
      configs: [haiku],
      now: () => new Date('2026-11-03T10:00:00.000Z'),
      clientFor: () => ({
        extractWithMetrics: async () => {
          calls += 1

          if (calls === 2) {
            throw new ExtractionProviderError('Réponse Anthropic interrompue : max_tokens.', {
              inputTokens: 1000,
              outputTokens: 16_000,
            })
          }

          return {
            output: { days: [] },
            inputTokens: 1000,
            outputTokens: 200,
            stopReason: 'end_turn',
            latencyMs: 5,
          }
        },
      }),
    })

    expect(calls).toBe(1 + MODEL_CHOICE_RULES.repetitions * cases.length)
    expect(recorded.stopped).toBeNull()
    expect(recorded.configs[0]?.repetitions[0]?.a).toMatchObject({
      ok: false,
      outputTokens: 16_000,
    })
  })

  it('s’arrête au plafond de coût', async () => {
    const recorded = await collectModelChoice({
      cases,
      configs: [sonnet],
      clientFor: () => ({
        extractWithMetrics: async () => ({
          output: {},
          inputTokens: 0,
          outputTokens: 600_000,
          stopReason: 'end_turn',
          latencyMs: 1,
        }),
      }),
    })

    expect(recorded.stopped).toMatch(/Plafond de 5 \$ atteint/)
    expect(recorded.configs[0]?.repetitions[0]).toEqual({})
  })
})
