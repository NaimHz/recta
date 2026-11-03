import {
  PlanSchema,
  SCHEMA_VERSION,
  normalizeExtractedPlan,
  resolveDayDates,
  runResolutionAgent,
  type CityConfig,
  type Place,
  type PlaceSearchTool,
  type Plan,
  type ResolutionAgentOption,
  type ResolutionAgentResult,
  type Stop,
  type StopResolution,
} from '@recta/domain'
import { extractPlan, type ExtractionClient } from '../extraction/client'
import type { OverpassClient } from '../sources/overpass'
import { mapOsmElementToPlace } from '../sources/osm/tags'

export type TextToPlanOptions = {
  city: CityConfig
  start: string | null
  today: string
}

export type TextToPlanDeps = {
  extraction: ExtractionClient
  search: PlaceSearchTool
  overpass: Pick<OverpassClient, 'query'>
  now?: () => string
}

export type StopResolutionSummary = {
  stopId: string
  name: string
  status: StopResolution
  question: string | null
  options: ResolutionAgentOption[]
}

export type TextToPlanResult = {
  plan: Plan
  resolutions: StopResolutionSummary[]
}

export class CityMismatchError extends Error {
  constructor(
    readonly written: string,
    readonly expected: string,
  ) {
    super(`Le texte mentionne « ${written} », la vérification porte sur ${expected}.`)
    this.name = 'CityMismatchError'
  }
}

const RESOLUTION_STATUS: Record<ResolutionAgentResult['status'], StopResolution> = {
  resolved: 'resolved',
  needs_clarification: 'ambiguous',
  not_found: 'not_found',
}

const OSM_ID = /^osm:(node|way|relation)\/(\d+)$/

function normalizeCity(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function osmPlacesQuery(placeIds: string[]): string | null {
  const ids = { node: [] as string[], way: [] as string[], relation: [] as string[] }

  for (const placeId of placeIds) {
    const match = OSM_ID.exec(placeId)

    if (match) ids[match[1] as keyof typeof ids].push(match[2] ?? '')
  }

  const statements = Object.entries(ids)
    .filter(([, values]) => values.length > 0)
    .map(([type, values]) => `${type}(id:${values.join(',')});`)

  return statements.length === 0
    ? null
    : `[out:json][timeout:25];\n(\n${statements.join('\n')}\n);\nout tags center;`
}

async function withOsmDetails(
  places: Place[],
  overpass: TextToPlanDeps['overpass'],
  retrievedAt: string,
): Promise<Map<string, Place>> {
  const details = new Map<string, Place>()
  const query = osmPlacesQuery(places.map((place) => place.id))

  if (query === null) return details

  try {
    const result = await overpass.query(query)

    for (const element of result.elements) {
      const place = mapOsmElementToPlace(element, { retrievedAt })

      if (place) details.set(place.id, place)
    }
  } catch {
    return details
  }

  return details
}

export async function buildPlanFromText(
  text: string,
  options: TextToPlanOptions,
  deps: TextToPlanDeps,
): Promise<TextToPlanResult> {
  const { city } = options
  const normalized = normalizeExtractedPlan(await extractPlan(text, deps.extraction))

  for (const day of normalized.days) {
    if (day.city !== null && !normalizeCity(day.city).includes(normalizeCity(city.name))) {
      throw new CityMismatchError(day.city, city.name)
    }
  }

  const dates = resolveDayDates(
    normalized.days.map((day) => day.dateText),
    { reference: options.start ?? options.today, start: options.start },
  )
  const stopInputs = normalized.days.flatMap((day) => day.stops)
  const resolutions: ResolutionAgentResult[] = []

  for (const stop of stopInputs) {
    resolutions.push(
      await runResolutionAgent({ name: stop.name, type: stop.type, city }, { search: deps.search }),
    )
  }

  const resolvedPlaces = resolutions.flatMap((result) => (result.place ? [result.place] : []))
  const details = await withOsmDetails(
    resolvedPlaces,
    deps.overpass,
    deps.now?.() ?? new Date().toISOString(),
  )
  const summaries: StopResolutionSummary[] = []
  let stopIndex = 0

  const plan = PlanSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    cityId: city.id,
    constraints: [],
    days: normalized.days.map((day, dayIndex) => ({
      id: `day-${dayIndex + 1}`,
      date: dates[dayIndex] ?? null,
      timezone: city.timezone,
      travels: [],
      stops: day.stops.map((stop): Stop => {
        const resolution = resolutions[stopIndex]
        const id = `stop-${stopIndex + 1}`
        const agentPlace = resolution?.status === 'resolved' ? resolution.place : null
        const place = agentPlace ? (details.get(agentPlace.id) ?? agentPlace) : null
        const status: StopResolution = place
          ? 'resolved'
          : resolution && resolution.status !== 'resolved'
            ? RESOLUTION_STATUS[resolution.status]
            : 'not_found'

        stopIndex += 1
        summaries.push({
          stopId: id,
          name: stop.name,
          status,
          question: resolution?.question ?? null,
          options: resolution?.options ?? [],
        })

        return {
          id,
          name: stop.name,
          sourceText: stop.sourceText,
          type: stop.type,
          resolution: status,
          place,
          start: stop.start,
          end: stop.end,
          windowSource: stop.windowSource,
        }
      }),
    })),
  })

  return { plan, resolutions: summaries }
}
