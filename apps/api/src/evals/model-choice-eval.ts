import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ExtractionProviderError,
  type ExtractionEffort,
  type ExtractionMetrics,
} from '../extraction/anthropic'
import { EXTRACTION_PROMPT_VERSION } from '../extraction/prompt'
import {
  runExtractionF1Eval,
  type ExtractionF1Case,
  type ExtractionF1Report,
  type RecordedOutput,
} from './extraction-f1-eval'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

export const MODEL_CHOICE_DIRECTORY = join(repoRoot, 'evals', 'model-choice')

export const MODEL_PRICES_SOURCE = {
  url: 'https://platform.claude.com/docs/en/about-claude/pricing',
  checkedAt: '2026-10-06',
  currency: 'USD',
} as const

export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
}

export type ModelChoiceConfig = {
  id: string
  model: string
  effort: ExtractionEffort
}

export const MODEL_CHOICE_CONFIGS: ModelChoiceConfig[] = [
  { id: 'haiku-medium', model: 'claude-haiku-5-5', effort: 'medium' },
  { id: 'haiku-low', model: 'claude-haiku-5-5', effort: 'low' },
  { id: 'sonnet-high', model: 'claude-sonnet-5-5', effort: 'high' },
  { id: 'sonnet-low', model: 'claude-sonnet-5-5', effort: 'low' },
]

export const MODEL_CHOICE_RULES = {
  repetitions: 2,
  costCapUsd: 5,
  f1Margin: 0.02,
  maxP95LatencyMs: 10_000,
} as const

export type ModelChoiceCall =
  | {
      ok: true
      output: unknown
      inputTokens: number
      outputTokens: number
      stopReason: string | null
      latencyMs: number
    }
  | {
      ok: false
      error: string
      inputTokens: number
      outputTokens: number
      latencyMs: number
    }

export type ModelChoiceRecordedConfig = ModelChoiceConfig & {
  warmup: ModelChoiceCall | null
  repetitions: Array<Record<string, ModelChoiceCall>>
}

export type ModelChoiceRecorded = {
  version: 1
  promptVersion: string
  measuredAt: string
  prices: typeof MODEL_PRICES_USD_PER_MTOK
  pricesSource: typeof MODEL_PRICES_SOURCE
  rules: typeof MODEL_CHOICE_RULES
  stopped: string | null
  configs: ModelChoiceRecordedConfig[]
}

export type ModelChoiceRepetitionScore = {
  schemaValidCount: number
  noInventionCount: number
  providerErrors: number
  macroF1: number
  microF1: number
  typeF1: number
}

export type ModelChoiceConfigReport = ModelChoiceConfig & {
  complete: boolean
  repetitions: ModelChoiceRepetitionScore[]
  macroF1: { min: number; mean: number }
  typeF1Mean: number
  calls: number
  meanInputTokens: number
  meanOutputTokens: number
  meanCostUsd: number
  totalCostUsd: number
  latency: { samples: number; p50Ms: number | null; p95Ms: number | null }
  eligible: boolean
  reasons: string[]
}

export type ModelChoiceReport = {
  version: 1
  measuredAt: string
  promptVersion: string
  corpusSize: number
  pricesSource: typeof MODEL_PRICES_SOURCE
  rules: typeof MODEL_CHOICE_RULES
  stopped: string | null
  bestMacroF1: number
  selected: string | null
  totalCostUsd: number
  configs: ModelChoiceConfigReport[]
}

export type MetricsClient = {
  extractWithMetrics(text: string): Promise<ExtractionMetrics>
}

export function callCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICES_USD_PER_MTOK[model]

  if (!price) {
    throw new Error(`Prix inconnu pour le modèle ${model}.`)
  }

  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

export function nearestRankPercentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))

  return sorted[index] ?? null
}

async function measureCall(client: MetricsClient, text: string): Promise<ModelChoiceCall> {
  const startedAt = performance.now()

  try {
    const metrics = await client.extractWithMetrics(text)

    return {
      ok: true,
      output: metrics.output,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      stopReason: metrics.stopReason,
      latencyMs: metrics.latencyMs,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      inputTokens: error instanceof ExtractionProviderError ? (error.usage?.inputTokens ?? 0) : 0,
      outputTokens: error instanceof ExtractionProviderError ? (error.usage?.outputTokens ?? 0) : 0,
      latencyMs: performance.now() - startedAt,
    }
  }
}

export async function collectModelChoice(options: {
  cases: ExtractionF1Case[]
  configs?: ModelChoiceConfig[]
  clientFor: (config: ModelChoiceConfig) => MetricsClient
  now?: () => Date
}): Promise<ModelChoiceRecorded> {
  const configs = options.configs ?? MODEL_CHOICE_CONFIGS
  const recordedConfigs: ModelChoiceRecordedConfig[] = []
  let spentUsd = 0
  let stopped: string | null = null

  const run = async (config: ModelChoiceConfig, text: string): Promise<ModelChoiceCall | null> => {
    if (spentUsd >= MODEL_CHOICE_RULES.costCapUsd) {
      stopped ??= `Plafond de ${MODEL_CHOICE_RULES.costCapUsd} $ atteint (${spentUsd.toFixed(4)} $).`
      return null
    }

    const call = await measureCall(options.clientFor(config), text)
    spentUsd += callCostUsd(config.model, call.inputTokens, call.outputTokens)

    return call
  }

  for (const config of configs) {
    const firstCase = options.cases[0]
    const recorded: ModelChoiceRecordedConfig = {
      ...config,
      warmup: firstCase ? await run(config, firstCase.text) : null,
      repetitions: [],
    }

    for (let repetition = 0; repetition < MODEL_CHOICE_RULES.repetitions; repetition += 1) {
      const calls: Record<string, ModelChoiceCall> = {}

      for (const testCase of options.cases) {
        const call = await run(config, testCase.text)

        if (!call) break

        calls[testCase.id] = call
      }

      recorded.repetitions.push(calls)
    }

    recordedConfigs.push(recorded)
  }

  return {
    version: 1,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    measuredAt: (options.now?.() ?? new Date()).toISOString(),
    prices: MODEL_PRICES_USD_PER_MTOK,
    pricesSource: MODEL_PRICES_SOURCE,
    rules: MODEL_CHOICE_RULES,
    stopped,
    configs: recordedConfigs,
  }
}

function toRecordedOutputs(calls: Record<string, ModelChoiceCall>): Record<string, RecordedOutput> {
  return Object.fromEntries(
    Object.entries(calls).map(([id, call]) => [
      id,
      call.ok ? { ok: true, output: call.output } : { ok: false, error: call.error },
    ]),
  )
}

function repetitionScore(report: ExtractionF1Report): ModelChoiceRepetitionScore {
  return {
    schemaValidCount: report.metrics.schemaValidCount,
    noInventionCount: report.metrics.noInventionCount,
    providerErrors: report.errorSummary.provider,
    macroF1: report.metrics.macroF1,
    microF1: report.metrics.microF1,
    typeF1: report.metrics.fieldScores.type.f1,
  }
}

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length

export async function buildModelChoiceReport(
  recorded: ModelChoiceRecorded,
  cases: ExtractionF1Case[],
  score: (outputs: Record<string, RecordedOutput>) => Promise<ExtractionF1Report> = (outputs) =>
    runExtractionF1Eval({ mode: 'recorded', source: null, outputs }),
): Promise<ModelChoiceReport> {
  const partial = await Promise.all(
    recorded.configs.map(async (config) => {
      const complete =
        config.repetitions.length === recorded.rules.repetitions &&
        config.repetitions.every((calls) => cases.every((testCase) => calls[testCase.id]))
      const repetitions = complete
        ? await Promise.all(
            config.repetitions.map(async (calls) =>
              repetitionScore(await score(toRecordedOutputs(calls))),
            ),
          )
        : []
      const measured = config.repetitions.flatMap((calls) => Object.values(calls))
      const billed = config.warmup ? [config.warmup, ...measured] : measured
      const costs = measured.map((call) =>
        callCostUsd(config.model, call.inputTokens, call.outputTokens),
      )
      const latencies = measured.map((call) => call.latencyMs)

      return {
        id: config.id,
        model: config.model,
        effort: config.effort,
        complete,
        repetitions,
        macroF1: {
          min: repetitions.length === 0 ? 0 : Math.min(...repetitions.map((rep) => rep.macroF1)),
          mean: mean(repetitions.map((rep) => rep.macroF1)),
        },
        typeF1Mean: mean(repetitions.map((rep) => rep.typeF1)),
        calls: measured.length,
        meanInputTokens: mean(measured.map((call) => call.inputTokens)),
        meanOutputTokens: mean(measured.map((call) => call.outputTokens)),
        meanCostUsd: mean(costs),
        totalCostUsd: billed.reduce(
          (total, call) => total + callCostUsd(config.model, call.inputTokens, call.outputTokens),
          0,
        ),
        latency: {
          samples: latencies.length,
          p50Ms: nearestRankPercentile(latencies, 0.5),
          p95Ms: nearestRankPercentile(latencies, 0.95),
        },
      }
    }),
  )

  const bestMacroF1 = Math.max(0, ...partial.map((config) => config.macroF1.mean))
  const configs: ModelChoiceConfigReport[] = partial.map((config) => {
    const reasons: string[] = []

    if (!config.complete) reasons.push('mesure incomplète')

    for (const [index, rep] of config.repetitions.entries()) {
      const label = `répétition ${index + 1}`

      if (rep.schemaValidCount < cases.length) {
        reasons.push(`${label} : schéma ${rep.schemaValidCount}/${cases.length}`)
      }
      if (rep.noInventionCount < cases.length) {
        reasons.push(`${label} : sans invention ${rep.noInventionCount}/${cases.length}`)
      }
      if (rep.providerErrors > 0) {
        reasons.push(`${label} : ${rep.providerErrors} erreur(s) fournisseur`)
      }
      if (rep.macroF1 < bestMacroF1 - recorded.rules.f1Margin) {
        reasons.push(
          `${label} : F1 macro ${rep.macroF1.toFixed(3)} < ${(bestMacroF1 - recorded.rules.f1Margin).toFixed(3)}`,
        )
      }
    }

    if (config.latency.p95Ms === null || config.latency.p95Ms > recorded.rules.maxP95LatencyMs) {
      reasons.push(
        `latence p95 ${config.latency.p95Ms === null ? 'inconnue' : `${Math.round(config.latency.p95Ms)} ms`} > ${recorded.rules.maxP95LatencyMs} ms`,
      )
    }

    return { ...config, eligible: reasons.length === 0, reasons }
  })

  const selected =
    configs
      .filter((config) => config.eligible)
      .sort((left, right) => left.meanCostUsd - right.meanCostUsd)[0]?.id ?? null

  return {
    version: 1,
    measuredAt: recorded.measuredAt,
    promptVersion: recorded.promptVersion,
    corpusSize: cases.length,
    pricesSource: recorded.pricesSource,
    rules: recorded.rules,
    stopped: recorded.stopped,
    bestMacroF1,
    selected,
    totalCostUsd: configs.reduce((total, config) => total + config.totalCostUsd, 0),
    configs,
  }
}

export async function readModelChoiceRecorded(): Promise<ModelChoiceRecorded> {
  return JSON.parse(
    await readFile(join(MODEL_CHOICE_DIRECTORY, 'recorded.json'), 'utf8'),
  ) as ModelChoiceRecorded
}
