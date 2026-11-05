import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ExtractedPlanSchema,
  ISSUE_CODES,
  PlanSchema,
  UNDETERMINED_REASONS,
  normalizeExtractedPlan,
  verifyPlan,
  type Plan,
  type TravelFacts,
} from '@recta/domain'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import { extractPlan } from '../extraction/client'
import { createAnthropicExtractionClientFromEnv } from '../extraction/anthropic'
import { EXTRACTION_PROMPT_VERSION } from '../extraction/prompt'
import { env } from '../env'
import { buildPlanFromText } from '../pipeline/text-to-plan'
import { NominatimPlaceSearch } from '../resolution/nominatim-search'
import { NominatimClient } from '../sources/nominatim'
import { OverpassClient } from '../sources/overpass'
import { OsrmClient } from '../sources/osrm'
import { TransitousClient } from '../sources/transitous'
import { loadCityConfig, loadVerificationFacts } from '../verification/facts'
import { collectTravelFacts } from '../verification/travel'
import {
  GoldAnnotationSchema,
  GoldPlanMetaSchema,
  annotationStops,
  scoreGoldSet,
  type GoldAnnotation,
  type GoldPlanInput,
  type GoldPlanMeta,
} from './verification-gold-eval'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const goldDirectory = join(repoRoot, 'evals', 'verification-gold')
const plansDirectory = join(goldDirectory, 'plans')
const annotationsDirectory = join(goldDirectory, 'annotations')
const runsDirectory = join(goldDirectory, 'runs')
const reportPath = join(goldDirectory, 'report.json')

const GoldRunSchema = z.strictObject({
  version: z.literal(1),
  plan: z.string().min(1),
  extraction: z.strictObject({
    model: z.string().nullable(),
    promptVersion: z.string().min(1),
    extractedAt: z.string().min(1),
    output: ExtractedPlanSchema,
  }),
  build: z
    .strictObject({
      ranAt: z.string().min(1),
      plan: PlanSchema,
      resolutions: z.array(z.unknown()),
      travel: z.custom<TravelFacts>(
        (value) => typeof value === 'object' && value !== null && 'walk' in value,
      ),
    })
    .nullable(),
})

type GoldRun = z.infer<typeof GoldRunSchema>

const runPath = (id: string) => join(runsDirectory, `${id}.json`)
const annotationPath = (id: string) => join(annotationsDirectory, `${id}.yml`)

async function readMeta(id: string): Promise<GoldPlanMeta> {
  return GoldPlanMetaSchema.parse(
    JSON.parse(await readFile(join(plansDirectory, `${id}.json`), 'utf8')),
  )
}

async function readText(id: string): Promise<string> {
  return readFile(join(plansDirectory, `${id}.txt`), 'utf8')
}

async function readRun(id: string): Promise<GoldRun | null> {
  if (!existsSync(runPath(id))) return null

  return GoldRunSchema.parse(JSON.parse(await readFile(runPath(id), 'utf8')))
}

async function readAnnotation(id: string): Promise<GoldAnnotation | null> {
  if (!existsSync(annotationPath(id))) return null

  return GoldAnnotationSchema.parse(parseYaml(await readFile(annotationPath(id), 'utf8')))
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function planIds(): Promise<string[]> {
  return (await readdir(plansDirectory))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort()
}

function skeleton(meta: GoldPlanMeta, stops: GoldAnnotation['stops']): string {
  const header = [
    `# Annotation 4.6 : ${meta.id} (${meta.cityId}, départ ${meta.start ?? 'inconnu'})`,
    '# Guide : evals/verification-gold/README.md. Texte : evals/verification-gold/plans/' +
      `${meta.id}.txt`,
    `# Codes : ${ISSUE_CODES.join(', ')}`,
    `# Raisons d'indéterminé : ${UNDETERMINED_REASONS.join(', ')}`,
    '# issues : { code, severity, stopIds, evidence: [{ source, url, sourceDate, raw }] }',
    '# undetermined : { codes, stopIds, reason }',
  ]
  const body = stringifyYaml({
    plan: meta.id,
    pass: 1,
    annotatedAt: null,
    minutes: null,
    stops,
    issues: [],
    undetermined: [],
    planted: [],
  })

  return `${header.join('\n')}\n${body}`
}

async function prepare(id: string): Promise<string> {
  const meta = await readMeta(id)

  if (existsSync(runPath(id))) return `${id} : déjà préparé, stops figés.`
  if (existsSync(annotationPath(id))) return `${id} : annotation déjà présente, rien n'est écrasé.`

  const output = await extractPlan(await readText(id), createAnthropicExtractionClientFromEnv())
  const stops = annotationStops(normalizeExtractedPlan(output))
  const run: GoldRun = {
    version: 1,
    plan: id,
    extraction: {
      model: env.EXTRACTION_MODEL ?? null,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      extractedAt: new Date().toISOString(),
      output,
    },
    build: null,
  }

  await mkdir(runsDirectory, { recursive: true })
  await mkdir(annotationsDirectory, { recursive: true })
  await writeJson(runPath(id), run)
  await writeFile(annotationPath(id), skeleton(meta, stops), 'utf8')

  return `${id} : ${stops.length} stops figés, squelette écrit.`
}

async function run(id: string): Promise<string> {
  const meta = await readMeta(id)
  const annotation = await readAnnotation(id)
  const recorded = await readRun(id)

  if (!recorded) return `${id} : pas préparé.`
  if (annotation?.annotatedAt == null) return `${id} : à annoter avant de lancer le système.`
  if (recorded.build) return `${id} : déjà lancé.`

  const city = await loadCityConfig(meta.cityId)
  const ranAt = new Date().toISOString()
  const overpass = new OverpassClient()
  let overpassError: unknown = null
  const { plan, resolutions } = await buildPlanFromText(
    await readText(id),
    { city, start: meta.start, today: meta.start ?? ranAt.slice(0, 10) },
    {
      extraction: { extract: async () => recorded.extraction.output },
      search: new NominatimPlaceSearch({ client: new NominatimClient() }),
      overpass: {
        query: async (query) => {
          try {
            return await overpass.query(query)
          } catch (error) {
            overpassError = error
            throw error
          }
        },
      },
    },
  )

  if (overpassError !== null) {
    return `${id} : Overpass indisponible, rien n'est enregistré. Relancer plus tard.`
  }

  const travel = await collectTravelFacts(
    plan,
    { osrm: new OsrmClient(), transitous: new TransitousClient() },
    city,
  )

  await writeJson(runPath(id), { ...recorded, build: { ranAt, plan, resolutions, travel } })

  const resolved = resolutions.filter((entry) => entry.status === 'resolved').length

  return `${id} : ${resolutions.length} stops, ${resolved} résolus, ${travel.walk.length} matrices à pied, ${travel.unavailable.length} trajets indisponibles.`
}

function assertSameStops(id: string, annotation: GoldAnnotation, plan: Plan): void {
  const annotated = annotation.stops.map((stop) => `${stop.id}|${stop.sourceText}`)
  const built = plan.days.flatMap((day) => day.stops.map((stop) => `${stop.id}|${stop.sourceText}`))

  if (annotated.join('\n') !== built.join('\n')) {
    throw new Error(`${id} : les stops annotés ne correspondent pas au plan lancé.`)
  }
}

function score(value: number | null): string {
  return value === null ? '—' : value.toFixed(3).replace('.', ',')
}

async function evaluate(): Promise<string> {
  const inputs: GoldPlanInput[] = []
  const pending: string[] = []

  for (const id of await planIds()) {
    const meta = await readMeta(id)
    const annotation = await readAnnotation(id)
    const recorded = await readRun(id)

    if (annotation?.annotatedAt == null || !recorded?.build) {
      pending.push(id)
      continue
    }

    assertSameStops(id, annotation, recorded.build.plan)

    const facts = await loadVerificationFacts(meta.cityId)

    inputs.push({
      meta,
      annotation,
      result: verifyPlan(recorded.build.plan, { ...facts, travel: recorded.build.travel }),
    })
  }

  const report = scoreGoldSet(inputs)

  await writeJson(reportPath, { ...report, pending })

  const lines = Object.entries(report.kinds).map(
    ([kind, entry]) =>
      `${kind} : ${entry.plans} plans | micro P ${score(entry.micro.precision)} R ${score(entry.micro.recall)} F1 ${score(entry.micro.f1)} | F1 macro ${score(entry.macroF1)} | abstentions ${entry.micro.fnAbstention} | FP sur indéterminé ${entry.micro.fpOnUndetermined}`,
  )

  lines.push(
    report.matrixFilled
      ? 'Matrice remplie : chaque code a au moins une clé annotée.'
      : `Matrice incomplète, codes sans clé annotée : ${report.missingCodes.join(', ')}`,
  )
  if (pending.length > 0) lines.push(`En attente : ${pending.join(', ')}`)
  lines.push(`Rapport : ${reportPath}`)

  return lines.join('\n')
}

async function main(): Promise<void> {
  const [command, ...ids] = process.argv.slice(2)

  if (command === 'eval') {
    console.log(await evaluate())
    return
  }

  if (command !== 'prepare' && command !== 'run') {
    console.error('Usage : gold:prepare <id…> | gold:run [id…] | eval:gold')
    process.exitCode = 2
    return
  }

  const targets = ids.length > 0 ? ids : command === 'run' ? await planIds() : []

  if (targets.length === 0) {
    console.error('gold:prepare demande au moins un identifiant de plan.')
    process.exitCode = 2
    return
  }

  for (const id of targets) {
    console.log(await (command === 'prepare' ? prepare(id) : run(id)))
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
