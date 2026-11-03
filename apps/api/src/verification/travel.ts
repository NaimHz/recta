import {
  localToInstant,
  type CityConfig,
  type Coordinates,
  type Plan,
  type Stop,
  type TransitLeg,
  type TravelFacts,
  type WalkMatrix,
} from '@recta/domain'
import { osrmAttribution, type OsrmClient } from '../sources/osrm'
import {
  transitousAttribution,
  type TransitousClient,
  type TransitousItinerary,
} from '../sources/transitous'

export type TravelClients = {
  osrm: Pick<OsrmClient, 'table'>
  transitous: Pick<TransitousClient, 'plan'>
}

type LocatedStop = Stop & { coordinates: Coordinates }

function located(stops: Stop[]): LocatedStop[] {
  return stops.flatMap((stop) =>
    stop.place?.coordinates ? [{ ...stop, coordinates: stop.place.coordinates }] : [],
  )
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function earliestArrival(
  itineraries: TransitousItinerary[],
  departureAt: string,
): TransitousItinerary | null {
  const departure = Date.parse(departureAt)

  return (
    itineraries
      .filter((itinerary) => Date.parse(itinerary.startTime) >= departure)
      .sort((left, right) => Date.parse(left.endTime) - Date.parse(right.endTime))[0] ?? null
  )
}

export async function collectTravelFacts(
  plan: Plan,
  clients: TravelClients,
  city: Pick<CityConfig, 'timezone' | 'capabilities'>,
  now: () => Date = () => new Date(),
): Promise<TravelFacts> {
  const travel: TravelFacts = { walk: [], transit: [], unavailable: [] }

  for (const day of plan.days) {
    const stops = located(day.stops)

    if (stops.length >= 2) {
      try {
        const table = await clients.osrm.table(stops.map((stop) => stop.coordinates))
        const walk: WalkMatrix = {
          dayId: day.id,
          stopIds: stops.map((stop) => stop.id),
          durationsSeconds: table.durationsSeconds,
          distancesMeters: table.distancesMeters,
          evidence: {
            source: 'osrm',
            sourceDate: null,
            retrievedAt: now().toISOString(),
            url: table.url,
            attribution: osrmAttribution,
            raw: JSON.stringify({
              durations: table.durationsSeconds,
              distances: table.distancesMeters,
            }),
            fields: { profile: 'foot', stopIds: stops.map((stop) => stop.id) },
          },
        }

        travel.walk.push(walk)
      } catch (error) {
        travel.unavailable.push({ service: 'osrm', scope: day.id, reason: reason(error) })
      }
    }

    if (!city.capabilities.transit || day.date === null) continue

    for (let index = 1; index < day.stops.length; index += 1) {
      const from = day.stops[index - 1]
      const to = day.stops[index]
      const fromCoordinates = from?.place?.coordinates
      const toCoordinates = to?.place?.coordinates

      if (!from || !to || !fromCoordinates || !toCoordinates || from.end === null) continue

      const scope = `${from.id}->${to.id}`
      const departureAt = localToInstant(day.date, from.end, city.timezone)

      if (departureAt === null) {
        travel.unavailable.push({
          service: 'transitous',
          scope,
          reason: `Heure locale inexistante : ${day.date} ${from.end}`,
        })
        continue
      }

      try {
        const result = await clients.transitous.plan({
          from: fromCoordinates,
          to: toCoordinates,
          time: departureAt,
        })
        const best = earliestArrival(result.itineraries, departureAt)
        const leg: TransitLeg = {
          fromStopId: from.id,
          toStopId: to.id,
          departureAt,
          durationSeconds: best
            ? (Date.parse(best.endTime) - Date.parse(departureAt)) / 1000
            : null,
          arrivalAt: best?.endTime ?? null,
          transfers: best?.transfers ?? null,
          modes: best ? [...new Set(best.legs.map((entry) => entry.mode))] : [],
          evidence: {
            source: 'transitous',
            sourceDate: day.date,
            retrievedAt: now().toISOString(),
            url: result.url,
            attribution: transitousAttribution,
            raw: JSON.stringify(best),
            fields: {
              from: from.name,
              to: to.name,
              departureAt,
              arrivalAt: best?.endTime ?? null,
              itinerariesReturned: result.itineraries.length,
            },
          },
        }

        travel.transit.push(leg)
      } catch (error) {
        travel.unavailable.push({ service: 'transitous', scope, reason: reason(error) })
      }
    }
  }

  return travel
}
