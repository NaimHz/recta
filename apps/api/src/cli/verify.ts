import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVerificationReport, verifyPlan } from '@recta/domain'
import { OsrmClient } from '../sources/osrm'
import { TransitousClient } from '../sources/transitous'
import { loadCityConfig, loadVerificationFacts } from '../verification/facts'
import { collectTravelFacts } from '../verification/travel'
import { parseFixture } from './fixture'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

function resolveInputPath(input: string): string {
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd()
  const direct = resolve(invocationDirectory, input)

  if (existsSync(direct)) return direct

  const fromRepoRoot = resolve(repoRoot, input)

  return existsSync(fromRepoRoot) ? fromRepoRoot : direct
}

async function main(): Promise<void> {
  const input = process.argv[2] ?? 'fixture.txt'
  const filePath = resolveInputPath(input)
  let text: string

  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`Impossible de lire ${filePath} : ${detail}`)
    process.exitCode = 1
    return
  }

  try {
    const plan = parseFixture(text)
    const city = await loadCityConfig(plan.cityId)
    const facts = await loadVerificationFacts(plan.cityId)
    const travel = await collectTravelFacts(
      plan,
      { osrm: new OsrmClient(), transitous: new TransitousClient() },
      city,
    )
    const result = verifyPlan(plan, { ...facts, travel })
    const report = buildVerificationReport(result)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`Fixture invalide : ${detail}`)
    process.exitCode = 1
  }
}

// Une violation est un résultat de vérification, pas une erreur d'exécution.
void main()
