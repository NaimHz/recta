import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAnthropicExtractionClientFromEnv,
  ExtractionProviderError,
} from '../extraction/anthropic'
import { EXTRACTION_PROMPT_VERSION } from '../extraction/prompt'
import {
  EXTRACTION_F1_FORMATS,
  F1_FIELDS,
  collectExtractionF1Outputs,
  loadExtractionF1Corpus,
  readExtractionF1Recorded,
  runExtractionF1Eval,
  type RecordedFile,
} from './extraction-f1-eval'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const live = process.argv.includes('--live')
const reportPath = join(
  repoRoot,
  'evals',
  'extraction-f1',
  live ? 'live-report.json' : 'report.json',
)
const recordedPath = join(repoRoot, 'evals', 'extraction-f1', 'recorded.json')

function percentage(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')} %`
}

function score(value: number): string {
  return value.toFixed(3).replace('.', ',')
}

async function main(): Promise<void> {
  let source: string | null = process.env.EXTRACTION_MODEL ?? null
  let outputs

  if (live) {
    const { cases } = await loadExtractionF1Corpus()
    const client = createAnthropicExtractionClientFromEnv()
    outputs = await collectExtractionF1Outputs(cases.cases, client)

    const recorded: RecordedFile = {
      version: 1,
      source,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      measuredAt: new Date().toISOString(),
      outputs,
    }

    await mkdir(join(repoRoot, 'evals', 'extraction-f1'), { recursive: true })
    await writeFile(recordedPath, `${JSON.stringify(recorded, null, 2)}\n`, 'utf8')
  } else {
    const recorded = await readExtractionF1Recorded()
    outputs = recorded.outputs
    source = recorded.source
  }

  const report = await runExtractionF1Eval({
    mode: live ? 'live' : 'recorded',
    source,
    outputs,
  })

  await mkdir(join(repoRoot, 'evals', 'extraction-f1'), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(
    `${report.metrics.total} textes | schéma ${report.metrics.schemaValidCount}/` +
      `${report.metrics.total} (${percentage(report.metrics.schemaValid)}) | ` +
      `sans invention ${report.metrics.noInventionCount}/${report.metrics.total} ` +
      `(${percentage(report.metrics.noInvention)}) | F1 macro ${score(report.metrics.macroF1)} | ` +
      `F1 micro ${score(report.metrics.microF1)} | mode ${report.mode}`,
  )
  console.log(
    `Formats : ${EXTRACTION_F1_FORMATS.map(
      (format) => `${format} ${score(report.byFormat[format].macroF1)}`,
    ).join(', ')}`,
  )
  console.log(
    `Champs : ${F1_FIELDS.map(
      (field) => `${field} ${score(report.metrics.fieldScores[field].f1)}`,
    ).join(', ')}`,
  )
  console.log(
    `Erreurs : ${
      Object.entries(report.errorSummary)
        .filter(([, count]) => count > 0)
        .map(([category, count]) => `${category} ${count}`)
        .join(', ') || 'aucune'
    }`,
  )
  console.log(`Rapport : ${reportPath}`)

  if (
    report.metrics.schemaValid < report.thresholds.schemaValid ||
    report.metrics.noInvention < report.thresholds.noInvention ||
    report.errorSummary.provider > 0
  ) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  if (error instanceof ExtractionProviderError) {
    console.error(error.message)
  } else {
    console.error(error)
  }

  process.exitCode = 1
})
