import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAnthropicExtractionClientFromEnv,
  ExtractionProviderError,
} from '../extraction/anthropic'
import { runExtractionEval } from './extraction-eval'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const live = process.argv.includes('--live')
const reportPath = join(repoRoot, 'evals', 'extraction', live ? 'live-report.json' : 'report.json')

function percentage(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')} %`
}

async function main(): Promise<void> {
  const report = live
    ? await runExtractionEval({
        client: createAnthropicExtractionClientFromEnv(),
        source: process.env.EXTRACTION_MODEL ?? null,
      })
    : await runExtractionEval()

  await mkdir(join(repoRoot, 'evals', 'extraction'), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(
    `${report.metrics.total} textes | schéma ${report.metrics.schemaValidCount}/` +
      `${report.metrics.total} (${percentage(report.metrics.schemaValid)}) | ` +
      `sans invention ${report.metrics.noInventionCount}/${report.metrics.total} ` +
      `(${percentage(report.metrics.noInvention)}) | erreurs ${report.errors.length} | ` +
      `mode ${report.mode}`,
  )
  console.log(
    `Seuils : schéma ≥ ${percentage(report.thresholds.schemaValid)}, ` +
      `sans invention ≥ ${percentage(report.thresholds.noInvention)}`,
  )
  console.log(
    `Erreurs : schéma ${report.errorSummary.schema}, ` +
      `invention ${report.errorSummary.invention}, ` +
      `fournisseur ${report.errorSummary.provider}`,
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
