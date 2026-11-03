import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NO_TRAVEL, buildVerificationReport, verifyPlan } from '@recta/domain'
import { OsrmClient } from '../sources/osrm'
import { TransitousClient } from '../sources/transitous'
import { loadCityConfig, loadVerificationFacts } from '../verification/facts'
import { collectTravelFacts } from '../verification/travel'
import { parseFixture } from './fixture'
import { exitCodeFor, renderMarkdown, type ExitCode } from './report'

export type VerifyOutput = {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const USAGE = 'Usage : pnpm verify [fichier] [--json] [--offline]'
const OPTIONS = new Set(['--json', '--offline'])

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

function resolveInputPath(input: string): string {
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd()
  const direct = resolve(invocationDirectory, input)

  if (existsSync(direct)) return direct

  const fromRepoRoot = resolve(repoRoot, input)

  return existsSync(fromRepoRoot) ? fromRepoRoot : direct
}

export async function runVerify(args: string[], output: VerifyOutput): Promise<ExitCode> {
  const unknown = args.filter((arg) => arg.startsWith('--') && !OPTIONS.has(arg))
  const files = args.filter((arg) => !arg.startsWith('--'))

  if (unknown.length > 0 || files.length > 1) {
    output.stderr(`${USAGE}\n`)
    return 2
  }

  const json = args.includes('--json')
  const offline = args.includes('--offline')
  const filePath = resolveInputPath(files[0] ?? 'fixture.txt')
  let text: string

  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    output.stderr(`Impossible de lire ${filePath} : ${detail}\n`)
    return 2
  }

  try {
    const plan = parseFixture(text)
    const city = await loadCityConfig(plan.cityId)
    const facts = await loadVerificationFacts(plan.cityId)
    const travel = offline
      ? NO_TRAVEL
      : await collectTravelFacts(
          plan,
          { osrm: new OsrmClient(), transitous: new TransitousClient() },
          city,
        )
    const report = buildVerificationReport(verifyPlan(plan, { ...facts, travel }))

    output.stdout(
      json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report, { offline }),
    )

    return exitCodeFor(report)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    output.stderr(`Fixture invalide : ${detail}\n`)
    return 2
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runVerify(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }).then((code) => {
    process.exitCode = code
  })
}
