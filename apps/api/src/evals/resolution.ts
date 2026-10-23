import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PlaceSchema, resolvePlaces, type Place } from '@recta/domain'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const casesPath = join(repoRoot, 'evals', 'resolution', 'cases.json')
const reportPath = join(repoRoot, 'evals', 'resolution', 'report.json')

type ResolutionCase = {
  id: string
  city: string
  query: string
  type?: string
  expectedPlaceId: string
}

type CasesFile = {
  version: number
  thresholds: {
    top1: number
    top3: number
  }
  candidateSource: string
  cases: ResolutionCase[]
}

type CandidateCity = {
  id: string
  name: string
  places: unknown[]
}

type CandidateFile = {
  cities: CandidateCity[]
}

type CaseResult = {
  id: string
  city: string
  query: string
  type: string | null
  expectedPlaceId: string
  top1: boolean
  top3: boolean
  ranked: Array<{
    id: string
    name: string
    score: number
    nameScore: number
    typeScore: number
    distanceScore: number
  }>
}

function assertCasesFile(value: unknown): asserts value is CasesFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Fichier de cas invalide.')
  }

  const file = value as Partial<CasesFile>

  if (!Array.isArray(file.cases) || file.cases.length !== 30) {
    throw new Error('30 cas de résolution attendus.')
  }

  if (!file.thresholds || typeof file.thresholds.top1 !== 'number') {
    throw new Error('Seuil top-1 manquant.')
  }

  if (typeof file.thresholds.top3 !== 'number') {
    throw new Error('Seuil top-3 manquant.')
  }

  if (typeof file.candidateSource !== 'string') {
    throw new Error('Source de candidats manquante.')
  }
}

function assertCandidateFile(value: unknown): asserts value is CandidateFile {
  if (!value || typeof value !== 'object' || !Array.isArray((value as CandidateFile).cities)) {
    throw new Error('Fichier de candidats invalide.')
  }
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')} %`
}

async function main(): Promise<void> {
  const casesFile = JSON.parse(await readFile(casesPath, 'utf8')) as unknown

  assertCasesFile(casesFile)

  const candidatesFile = JSON.parse(
    await readFile(join(repoRoot, casesFile.candidateSource), 'utf8'),
  ) as unknown

  assertCandidateFile(candidatesFile)

  const candidatesByCity = new Map<string, Place[]>()

  for (const city of candidatesFile.cities) {
    candidatesByCity.set(
      city.id,
      city.places.map((place) => PlaceSchema.parse(place)),
    )
  }

  const seenCaseIds = new Set<string>()
  const caseResults: CaseResult[] = []

  for (const testCase of casesFile.cases) {
    if (seenCaseIds.has(testCase.id)) {
      throw new Error(`Cas dupliqué : ${testCase.id}`)
    }

    seenCaseIds.add(testCase.id)

    const candidates = candidatesByCity.get(testCase.city)

    if (!candidates) {
      throw new Error(`Ville inconnue pour ${testCase.id} : ${testCase.city}`)
    }

    if (!candidates.some((candidate) => candidate.id === testCase.expectedPlaceId)) {
      throw new Error(`Lieu attendu absent du pool ${testCase.city} : ${testCase.expectedPlaceId}`)
    }

    const ranked = resolvePlaces(
      {
        name: testCase.query,
        ...(testCase.type ? { type: testCase.type } : {}),
      },
      candidates,
    )
    const top1 = ranked[0]?.place.id === testCase.expectedPlaceId
    const top3 = ranked
      .slice(0, 3)
      .some((candidate) => candidate.place.id === testCase.expectedPlaceId)

    caseResults.push({
      id: testCase.id,
      city: testCase.city,
      query: testCase.query,
      type: testCase.type ?? null,
      expectedPlaceId: testCase.expectedPlaceId,
      top1,
      top3,
      ranked: ranked.map((candidate) => ({
        id: candidate.place.id,
        name: candidate.place.name,
        score: candidate.score,
        nameScore: candidate.components.name,
        typeScore: candidate.components.type,
        distanceScore: candidate.components.distance,
      })),
    })
  }

  const total = caseResults.length
  const top1Count = caseResults.filter((result) => result.top1).length
  const top3Count = caseResults.filter((result) => result.top3).length
  const abstentions = caseResults.filter((result) => result.ranked.length === 0).length
  const metrics = {
    total,
    top1Count,
    top3Count,
    top1: top1Count / total,
    top3: top3Count / total,
    abstentions,
  }

  const report = {
    version: 1,
    measuredAt: new Date().toISOString(),
    candidateSource: casesFile.candidateSource,
    thresholds: casesFile.thresholds,
    metrics,
    cases: caseResults,
  }

  await mkdir(join(repoRoot, 'evals', 'resolution'), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(
    `${total} cas | top-1 ${top1Count}/${total} (${percentage(metrics.top1)}) | ` +
      `top-3 ${top3Count}/${total} (${percentage(metrics.top3)}) | ` +
      `abstentions ${abstentions}`,
  )
  console.log(
    `Seuils : top-1 ≥ ${percentage(casesFile.thresholds.top1)}, ` +
      `top-3 ≥ ${percentage(casesFile.thresholds.top3)}`,
  )
  console.log(`Rapport : ${reportPath}`)

  if (metrics.top1 < casesFile.thresholds.top1 || metrics.top3 < casesFile.thresholds.top3) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
