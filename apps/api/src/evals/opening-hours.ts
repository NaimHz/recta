import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runOpeningHoursEval } from './opening-hours-eval'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const reportPath = join(repoRoot, 'evals', 'opening-hours', 'report.json')

function percentage(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')} %`
}

async function main(): Promise<void> {
  const report = await runOpeningHoursEval()
  const { metrics, thresholds } = report
  const { byStatus } = metrics

  await mkdir(join(repoRoot, 'evals', 'opening-hours'), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(
    `${metrics.total} cas horaires | exacts ${metrics.correct}/${metrics.total} ` +
      `(${percentage(metrics.correctRate)}) | conformes ` +
      `${byStatus.conforme.correct}/${byStatus.conforme.total} | violations ` +
      `${byStatus.violation.correct}/${byStatus.violation.total} | indéterminés ` +
      `${byStatus['indéterminé'].correct}/${byStatus['indéterminé'].total} | ` +
      `erreurs ${report.errors.length}`,
  )
  console.log(`Seuil : exacts ≥ ${percentage(thresholds.exact)}`)
  console.log(`Rapport : ${reportPath}`)

  for (const group of report.errorSummary) {
    console.log(`- ${group.category} : ${group.count}`)
  }

  if (metrics.correctRate < thresholds.exact) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
