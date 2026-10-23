import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runResolutionEval } from './resolution-eval'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const reportPath = join(repoRoot, 'evals', 'resolution', 'report.json')

function percentage(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')} %`
}

async function main(): Promise<void> {
  const report = await runResolutionEval()
  const { metrics, thresholds } = report

  await mkdir(join(repoRoot, 'evals', 'resolution'), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(
    `${metrics.total} cas | top-1 ${metrics.top1Count}/${metrics.total} (${percentage(metrics.top1)}) | ` +
      `top-3 ${metrics.top3Count}/${metrics.total} (${percentage(metrics.top3)}) | ` +
      `abstentions ${metrics.abstentions} | erreurs ${report.errors.length}`,
  )
  console.log(
    `Seuils : top-1 ≥ ${percentage(thresholds.top1)}, top-3 ≥ ${percentage(thresholds.top3)}`,
  )
  console.log(`Rapport : ${reportPath}`)

  if (metrics.top1 < thresholds.top1 || metrics.top3 < thresholds.top3) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
