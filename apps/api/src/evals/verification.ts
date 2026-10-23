import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runOpeningHoursEval } from './opening-hours-eval'
import { runResolutionEval } from './resolution-eval'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const reportPath = join(repoRoot, 'evals', 'verification', 'report.json')

function percentage(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')} %`
}

async function main(): Promise<void> {
  const resolution = await runResolutionEval()
  const openingHours = await runOpeningHoursEval()
  const errors = resolution.errors.length + openingHours.errors.length

  const report = {
    version: 1,
    measuredAt: new Date().toISOString(),
    resolution,
    openingHours,
    errors: {
      total: errors,
      resolution: resolution.errorSummary,
      openingHours: openingHours.errorSummary,
    },
  }

  await mkdir(join(repoRoot, 'evals', 'verification'), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(
    `Résolution : ${resolution.metrics.total} cas | ` +
      `top-1 ${resolution.metrics.top1Count}/${resolution.metrics.total} ` +
      `(${percentage(resolution.metrics.top1)}) | ` +
      `top-3 ${resolution.metrics.top3Count}/${resolution.metrics.total} ` +
      `(${percentage(resolution.metrics.top3)}) | ` +
      `abstentions ${resolution.metrics.abstentions} | ` +
      `erreurs ${resolution.errors.length}`,
  )
  console.log(
    `Horaires : ${openingHours.metrics.total} cas | ` +
      `exacts ${openingHours.metrics.correct}/${openingHours.metrics.total} ` +
      `(${percentage(openingHours.metrics.correctRate)}) | ` +
      `erreurs ${openingHours.errors.length}`,
  )
  console.log(`Erreurs listées : ${errors}`)
  console.log(`Rapport : ${reportPath}`)

  for (const group of resolution.errorSummary) {
    console.log(`- résolution / ${group.category} : ${group.count}`)
  }

  for (const group of openingHours.errorSummary) {
    console.log(`- horaires / ${group.category} : ${group.count}`)
  }

  if (
    resolution.metrics.top1 < resolution.thresholds.top1 ||
    resolution.metrics.top3 < resolution.thresholds.top3 ||
    openingHours.metrics.correctRate < openingHours.thresholds.exact
  ) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
