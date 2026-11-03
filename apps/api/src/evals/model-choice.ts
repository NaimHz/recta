import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '../env'
import { AnthropicExtractionClient, ExtractionProviderError } from '../extraction/anthropic'
import { loadExtractionF1Corpus } from './extraction-f1-eval'
import {
  MODEL_CHOICE_DIRECTORY,
  buildModelChoiceReport,
  collectModelChoice,
  readModelChoiceRecorded,
} from './model-choice-eval'

const live = process.argv.includes('--live')

function score(value: number): string {
  return value.toFixed(3).replace('.', ',')
}

function usd(value: number): string {
  return `${value.toFixed(5).replace('.', ',')} $`
}

function ms(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`
}

async function main(): Promise<void> {
  const { cases } = await loadExtractionF1Corpus()
  let recorded

  if (live) {
    const apiKey = env.ANTHROPIC_API_KEY

    if (!apiKey) {
      throw new ExtractionProviderError('ANTHROPIC_API_KEY manquante : le mode live est désactivé.')
    }

    recorded = await collectModelChoice({
      cases: cases.cases,
      clientFor: (config) =>
        new AnthropicExtractionClient({ apiKey, model: config.model, effort: config.effort }),
    })

    await mkdir(MODEL_CHOICE_DIRECTORY, { recursive: true })
    await writeFile(
      join(MODEL_CHOICE_DIRECTORY, 'recorded.json'),
      `${JSON.stringify(recorded, null, 2)}\n`,
      'utf8',
    )
  } else {
    recorded = await readModelChoiceRecorded()
  }

  const report = await buildModelChoiceReport(recorded, cases.cases)
  const reportPath = join(MODEL_CHOICE_DIRECTORY, 'report.json')

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  for (const config of report.configs) {
    console.log(
      `${config.id.padEnd(13)} | F1 macro min ${score(config.macroF1.min)} moy ${score(config.macroF1.mean)} | ` +
        `type ${score(config.typeF1Mean)} | ${usd(config.meanCostUsd)}/extraction | ` +
        `p50 ${ms(config.latency.p50Ms)} p95 ${ms(config.latency.p95Ms)} | ` +
        `${config.eligible ? 'éligible' : `exclu : ${config.reasons.join(' ; ')}`}`,
    )
  }

  console.log(
    `Meilleur F1 macro ${score(report.bestMacroF1)} | retenu : ${report.selected ?? 'aucun'} | ` +
      `coût total ${usd(report.totalCostUsd)} | mode ${live ? 'live' : 'rejeu'}`,
  )

  if (report.stopped) console.log(`Arrêt : ${report.stopped}`)
  console.log(`Rapport : ${reportPath}`)

  if (!report.selected || report.stopped) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
