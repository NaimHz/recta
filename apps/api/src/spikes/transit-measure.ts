import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const spikesDirectory = join(repoRoot, 'evals', 'spikes')
const fixturePath = join(spikesDirectory, 'transit-trips.json')

type Coordinates = {
  name: string
  lat: number
  lon: number
}

type Trip = {
  id: string
  from: Coordinates
  to: Coordinates
}

type City = {
  id: string
  name: string
  trips: Trip[]
}

type Criteria = {
  minSuccessRate: number
  maxP95LatencyMs: number
  note?: string
}

type ServiceConfig = {
  endpoint: string
  userAgent: string
  profile?: string
  policy?: string
}

type Services = {
  transitous: ServiceConfig
  osrm: ServiceConfig
}

type Fixture = {
  version: number
  protocol: string
  departure: string
  criteria: Criteria
  services: Services
  cities: City[]
  attribution: string
}

type TransitousResult = {
  ok: boolean
  latencyMs: number
  httpStatus: number | null
  error: string | null
  durationSeconds: number | null
  transfers: number | null
  transitLegs: number | null
  modes: string[]
  itinerariesReturned: number | null
  startTime: string | null
  endTime: string | null
}

type OsrmResult = {
  ok: boolean
  latencyMs: number
  httpStatus: number | null
  error: string | null
  durationSeconds: number | null
  distanceMeters: number | null
  speedKmh: number | null
  plausibleWalk: boolean | null
}

type TripResult = {
  id: string
  from: string
  to: string
  transitous: TransitousResult
  osrm: OsrmResult
}

type CityResult = {
  id: string
  name: string
  trips: TripResult[]
}

type ServiceSummary = {
  requests: number
  successes: number
  failures: number
  successRate: number
  failureRate: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
  technicalStatus: 'ok' | 'degraded'
}

type TransitousLeg = {
  mode?: string
}

type TransitousItinerary = {
  duration?: number
  transfers?: number
  startTime?: string
  endTime?: string
  legs?: TransitousLeg[]
}

type TransitousResponse = {
  itineraries?: TransitousItinerary[]
}

type OsrmRoute = {
  duration?: number
  distance?: number
}

type OsrmResponse = {
  code?: string
  routes?: OsrmRoute[]
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const round = (value: number, digits = 1): number => Number(value.toFixed(digits))

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))

  return sorted[index] ?? null
}

function summarize(
  results: Array<{ ok: boolean; latencyMs: number }>,
  criteria: Criteria,
): ServiceSummary {
  const requests = results.length
  const successes = results.filter((result) => result.ok).length
  const failures = requests - successes
  const successRate = requests === 0 ? 0 : successes / requests
  const failureRate = requests === 0 ? 1 : failures / requests
  const latencies = results.map((result) => result.latencyMs)
  const p50 = percentile(latencies, 0.5)
  const p95 = percentile(latencies, 0.95)
  const max = latencies.length === 0 ? null : Math.max(...latencies)
  const technicalStatus: ServiceSummary['technicalStatus'] =
    successRate >= criteria.minSuccessRate && p95 !== null && p95 <= criteria.maxP95LatencyMs
      ? 'ok'
      : 'degraded'

  return {
    requests,
    successes,
    failures,
    successRate: round(successRate, 4),
    failureRate: round(failureRate, 4),
    p50Ms: p50 === null ? null : round(p50),
    p95Ms: p95 === null ? null : round(p95),
    maxMs: max === null ? null : round(max),
    technicalStatus,
  }
}

function transitousError(
  latencyMs: number,
  httpStatus: number | null,
  error: string,
): TransitousResult {
  return {
    ok: false,
    latencyMs,
    httpStatus,
    error,
    durationSeconds: null,
    transfers: null,
    transitLegs: null,
    modes: [],
    itinerariesReturned: null,
    startTime: null,
    endTime: null,
  }
}

async function callTransitous(
  trip: Trip,
  departure: string,
  config: ServiceConfig,
): Promise<TransitousResult> {
  const url = new URL(config.endpoint)
  url.searchParams.set('fromPlace', `${trip.from.lat},${trip.from.lon}`)
  url.searchParams.set('toPlace', `${trip.to.lat},${trip.to.lon}`)
  url.searchParams.set('time', departure)
  url.searchParams.set('numItineraries', '1')
  url.searchParams.set('transitModes', 'TRANSIT')
  url.searchParams.set('directModes', 'WALK')
  url.searchParams.set('searchWindow', '900')
  const started = performance.now()

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': config.userAgent,
      },
      signal: AbortSignal.timeout(30_000),
    })
    const latencyMs = performance.now() - started
    const text = await response.text()

    if (!response.ok) {
      return transitousError(
        latencyMs,
        response.status,
        `HTTP ${response.status}: ${text.slice(0, 200)}`,
      )
    }

    let payload: TransitousResponse

    try {
      payload = JSON.parse(text) as TransitousResponse
    } catch {
      return transitousError(latencyMs, response.status, 'JSON invalide')
    }

    const itineraries = payload.itineraries ?? []
    const itinerary = itineraries[0]

    if (!itinerary) {
      return {
        ...transitousError(latencyMs, response.status, 'Aucun itinéraire'),
        itinerariesReturned: 0,
      }
    }

    const legs = itinerary.legs ?? []
    const modes = [
      ...new Set(legs.map((leg) => leg.mode).filter((mode): mode is string => Boolean(mode))),
    ]

    return {
      ok: true,
      latencyMs,
      httpStatus: response.status,
      error: null,
      durationSeconds: typeof itinerary.duration === 'number' ? itinerary.duration : null,
      transfers: typeof itinerary.transfers === 'number' ? itinerary.transfers : null,
      transitLegs: legs.filter((leg) => leg.mode !== undefined && leg.mode !== 'WALK').length,
      modes,
      itinerariesReturned: itineraries.length,
      startTime: itinerary.startTime ?? null,
      endTime: itinerary.endTime ?? null,
    }
  } catch (error) {
    return transitousError(
      performance.now() - started,
      null,
      error instanceof Error ? error.message : String(error),
    )
  }
}

function osrmError(latencyMs: number, httpStatus: number | null, error: string): OsrmResult {
  return {
    ok: false,
    latencyMs,
    httpStatus,
    error,
    durationSeconds: null,
    distanceMeters: null,
    speedKmh: null,
    plausibleWalk: null,
  }
}

async function callOsrm(trip: Trip, config: ServiceConfig): Promise<OsrmResult> {
  const coordinates = `${trip.from.lon},${trip.from.lat};${trip.to.lon},${trip.to.lat}`
  const profile = config.profile ?? 'foot'
  const url = `${config.endpoint}/route/v1/${profile}/${coordinates}?overview=false&steps=false`
  const started = performance.now()

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': config.userAgent,
      },
      signal: AbortSignal.timeout(30_000),
    })
    const latencyMs = performance.now() - started
    const text = await response.text()

    if (!response.ok) {
      return osrmError(latencyMs, response.status, `HTTP ${response.status}: ${text.slice(0, 200)}`)
    }

    let payload: OsrmResponse

    try {
      payload = JSON.parse(text) as OsrmResponse
    } catch {
      return osrmError(latencyMs, response.status, 'JSON invalide')
    }

    const route = payload.routes?.[0]

    if (payload.code !== 'Ok' || !route) {
      return osrmError(
        latencyMs,
        response.status,
        payload.code ? `OSRM ${payload.code}` : 'Aucune route',
      )
    }

    const durationSeconds = typeof route.duration === 'number' ? route.duration : null
    const distanceMeters = typeof route.distance === 'number' ? route.distance : null
    const speedKmh =
      durationSeconds !== null && durationSeconds > 0 && distanceMeters !== null
        ? distanceMeters / 1000 / (durationSeconds / 3600)
        : null

    return {
      ok: true,
      latencyMs,
      httpStatus: response.status,
      error: null,
      durationSeconds,
      distanceMeters,
      speedKmh: speedKmh === null ? null : round(speedKmh),
      plausibleWalk: speedKmh === null ? null : speedKmh >= 2 && speedKmh <= 8,
    }
  } catch (error) {
    return osrmError(
      performance.now() - started,
      null,
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function main(): Promise<void> {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
  const measuredAt = new Date()
  const cities: CityResult[] = []
  const allTransitous: TransitousResult[] = []
  const allOsrm: OsrmResult[] = []

  for (const city of fixture.cities) {
    const trips: TripResult[] = []

    for (const trip of city.trips) {
      console.log(`Mesure : ${city.name} — ${trip.id}`)
      const transitous = await callTransitous(trip, fixture.departure, fixture.services.transitous)
      await sleep(1_100)
      const osrm = await callOsrm(trip, fixture.services.osrm)
      await sleep(1_100)

      trips.push({
        id: trip.id,
        from: trip.from.name,
        to: trip.to.name,
        transitous,
        osrm,
      })
      allTransitous.push(transitous)
      allOsrm.push(osrm)
      console.log(
        `  Transitous ${transitous.ok ? 'OK' : 'ÉCHEC'} ${Math.round(transitous.latencyMs)} ms` +
          ` | OSRM ${osrm.ok ? 'OK' : 'ÉCHEC'} ${Math.round(osrm.latencyMs)} ms`,
      )
    }

    cities.push({
      id: city.id,
      name: city.name,
      trips,
    })
  }

  const citySummaries = Object.fromEntries(
    cities.map((city) => [
      city.id,
      {
        transitous: summarize(
          city.trips.map((trip) => trip.transitous),
          fixture.criteria,
        ),
        osrm: summarize(
          city.trips.map((trip) => trip.osrm),
          fixture.criteria,
        ),
      },
    ]),
  )
  const overall = {
    transitous: summarize(allTransitous, fixture.criteria),
    osrm: summarize(allOsrm, fixture.criteria),
  }
  const transitousSuccesses = allTransitous.filter((result) => result.ok)
  const osrmSuccesses = allOsrm.filter((result) => result.ok)
  const quality = {
    transitous: {
      successes: transitousSuccesses.length,
      withTransitLeg: transitousSuccesses.filter((result) => (result.transitLegs ?? 0) > 0).length,
      walkOnly: transitousSuccesses.filter((result) => (result.transitLegs ?? 0) === 0).length,
    },
    osrm: {
      successes: osrmSuccesses.length,
      plausibleWalk: osrmSuccesses.filter((result) => result.plausibleWalk === true).length,
      implausibleWalk: osrmSuccesses.filter((result) => result.plausibleWalk === false).length,
    },
  }
  const verdict = {
    technical: {
      transitous: overall.transitous.technicalStatus,
      osrm: overall.osrm.technicalStatus,
    },
    policy: {
      transitous: 'prototype_non_commercial_only',
      osrm: 'public_instance_spike_only',
    },
    fallback: {
      transitous: 'indéterminé si indisponible',
      osrm: 'auto-héberger OSRM avec profil piéton, sinon estimation + indéterminé',
    },
  }
  const raw = {
    version: 1,
    measuredAt: measuredAt.toISOString(),
    protocol: fixture.protocol,
    departure: fixture.departure,
    services: fixture.services,
    cities,
    attribution: fixture.attribution,
  }
  const summary = {
    version: 1,
    measuredAt: measuredAt.toISOString(),
    protocol: fixture.protocol,
    departure: fixture.departure,
    criteria: fixture.criteria,
    overall,
    cities: citySummaries,
    quality,
    verdict,
  }

  await writeFile(
    join(spikesDirectory, 'transit-raw.json'),
    `${JSON.stringify(raw, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    join(spikesDirectory, 'transit-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  )
  console.log(
    'Résultats écrits dans evals/spikes/transit-raw.json et evals/spikes/transit-summary.json.',
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
