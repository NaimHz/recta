import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IsoDateSchema,
  NO_TRAVEL,
  buildVerificationReport,
  localDateTimeInTimezone,
  verifyPlan,
  type Plan,
} from '@recta/domain'
import { createAnthropicExtractionClientFromEnv } from '../extraction/anthropic'
import { buildPlanFromText, type StopResolutionSummary } from '../pipeline/text-to-plan'
import { NominatimPlaceSearch } from '../resolution/nominatim-search'
import { NominatimClient } from '../sources/nominatim'
import { OsrmClient } from '../sources/osrm'
import { OverpassClient } from '../sources/overpass'
import { TransitousClient } from '../sources/transitous'
import { loadCityConfig, loadVerificationFacts } from '../verification/facts'
import { collectTravelFacts } from '../verification/travel'
import { parseFixture } from './fixture'
import { exitCodeFor, renderMarkdown, renderResolutions, type ExitCode } from './report'

export type VerifyOutput = {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const USAGE = [
  'Usage : pnpm verify [fixture] [--json] [--offline]',
  '        pnpm verify <texte> --text --city <ville> [--start YYYY-MM-DD] [--json]',
  '        --offline est refusé avec --text : extraction et résolution passent par le réseau.',
].join('\n')
const FLAGS = new Set(['--json', '--offline', '--text'])
const VALUED = new Set(['--city', '--start'])

type VerifyArgs = {
  file: string
  json: boolean
  offline: boolean
  text: boolean
  city: string | null
  start: string | null
}

function parseArgs(args: string[]): VerifyArgs | null {
  const files: string[] = []
  const values = new Map<string, string>()
  const flags = new Set<string>()

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''

    if (FLAGS.has(arg)) {
      flags.add(arg)
    } else if (VALUED.has(arg)) {
      const value = args[index + 1]

      if (value === undefined || value.startsWith('--')) return null

      values.set(arg, value)
      index += 1
    } else if (arg.startsWith('--')) {
      return null
    } else {
      files.push(arg)
    }
  }

  const parsed: VerifyArgs = {
    file: files[0] ?? 'fixture.txt',
    json: flags.has('--json'),
    offline: flags.has('--offline'),
    text: flags.has('--text'),
    city: values.get('--city') ?? null,
    start: values.get('--start') ?? null,
  }

  if (files.length > 1) return null
  if (parsed.text && (parsed.city === null || parsed.offline)) return null
  if (!parsed.text && (parsed.city !== null || parsed.start !== null)) return null
  if (parsed.start !== null && !IsoDateSchema.safeParse(parsed.start).success) return null

  return parsed
}

async function planFromText(
  text: string,
  cityId: string,
  start: string | null,
): Promise<{ plan: Plan; resolutions: StopResolutionSummary[] }> {
  const city = await loadCityConfig(cityId)
  const today =
    localDateTimeInTimezone(new Date(), city.timezone)?.date ??
    new Date().toISOString().slice(0, 10)

  return buildPlanFromText(
    text,
    { city, start, today },
    {
      extraction: createAnthropicExtractionClientFromEnv(),
      search: new NominatimPlaceSearch({ client: new NominatimClient() }),
      overpass: new OverpassClient(),
    },
  )
}

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

function resolveInputPath(input: string): string {
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd()
  const direct = resolve(invocationDirectory, input)

  if (existsSync(direct)) return direct

  const fromRepoRoot = resolve(repoRoot, input)

  return existsSync(fromRepoRoot) ? fromRepoRoot : direct
}

export async function runVerify(args: string[], output: VerifyOutput): Promise<ExitCode> {
  const options = parseArgs(args)

  if (options === null) {
    output.stderr(`${USAGE}\n`)
    return 2
  }

  const filePath = resolveInputPath(options.file)
  let text: string

  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    output.stderr(`Impossible de lire ${filePath} : ${detail}\n`)
    return 2
  }

  try {
    const { plan, resolutions } = options.text
      ? await planFromText(text, options.city ?? '', options.start)
      : { plan: parseFixture(text), resolutions: null }
    const city = await loadCityConfig(plan.cityId)
    const facts = await loadVerificationFacts(plan.cityId)
    const travel = options.offline
      ? NO_TRAVEL
      : await collectTravelFacts(
          plan,
          { osrm: new OsrmClient(), transitous: new TransitousClient() },
          city,
        )
    const report = buildVerificationReport(verifyPlan(plan, { ...facts, travel }))

    if (options.json) {
      const payload = resolutions === null ? report : { report, resolutions }

      output.stdout(`${JSON.stringify(payload, null, 2)}\n`)
    } else {
      output.stdout(
        renderMarkdown(report, { offline: options.offline }) +
          (resolutions === null ? '' : renderResolutions(resolutions)),
      )
    }

    return exitCodeFor(report)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    output.stderr(`${options.text ? 'Vérification impossible' : 'Fixture invalide'} : ${detail}\n`)
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
