import {
  announcedDepartureDate,
  localToInstant,
  type AnnouncedTravel,
  type AnnouncedTravelCheck,
  type CityConfig,
  type Coordinates,
  type Plan,
  type Stop,
  type TransitLeg,
  type TravelFacts,
  type TravelMode,
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

export const TRANSIT_MODES_BY_TRAVEL_MODE: Record<TravelMode, string> = {
  metro: 'SUBWAY',
  rer: 'SUBURBAN,REGIONAL_RAIL,RAIL',
  train: 'SUBURBAN,REGIONAL_RAIL,RAIL',
  tram: 'TRAM',
  bus: 'BUS',
  transit: 'TRANSIT',
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

const LEG_MODES_BY_TRAVEL_MODE: Record<TravelMode, readonly string[] | null> = {
  metro: ['SUBWAY'],
  rer: ['SUBURBAN', 'REGIONAL_RAIL', 'RAIL'],
  train: ['SUBURBAN', 'REGIONAL_RAIL', 'RAIL'],
  tram: ['TRAM'],
  bus: ['BUS'],
  transit: null,
}

type Departure = { at: string; itinerary: TransitousItinerary }

function nextDeparture(
  itineraries: TransitousItinerary[],
  requestedAt: string,
  mode: TravelMode,
  line: string | null,
): Departure | null {
  const requested = Date.parse(requestedAt)
  const legModes = LEG_MODES_BY_TRAVEL_MODE[mode]
  const wantedLine = line?.toLowerCase() ?? null

  return (
    itineraries
      .flatMap((itinerary): Departure[] => {
        const leg = itinerary.legs.find(
          (entry) =>
            entry.mode !== 'WALK' &&
            (legModes === null || legModes.includes(entry.mode)) &&
            (wantedLine === null || entry.routeShortName?.toLowerCase() === wantedLine),
        )

        return leg && Date.parse(leg.startTime) >= requested
          ? [{ at: leg.startTime, itinerary }]
          : []
      })
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))[0] ?? null
  )
}

function travelTarget(travel: AnnouncedTravel, stops: Stop[]): Coordinates | null {
  if (travel.toStopId !== null) {
    return stops.find((stop) => stop.id === travel.toStopId)?.place?.coordinates ?? null
  }

  return travel.toPlace?.coordinates ?? null
}

export async function collectTravelFacts(
  plan: Plan,
  clients: TravelClients,
  city: Pick<CityConfig, 'timezone' | 'capabilities'>,
  now: () => Date = () => new Date(),
): Promise<TravelFacts> {
  const travel: TravelFacts = { walk: [], transit: [], announced: [], unavailable: [] }

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

    for (const announced of day.travels) {
      const from = day.stops.find((stop) => stop.id === announced.fromStopId)?.place?.coordinates
      const to = travelTarget(announced, day.stops)
      const requestedAt =
        announced.departure === null
          ? null
          : localToInstant(
              announcedDepartureDate(day.date, day, announced),
              announced.departure,
              city.timezone,
            )

      if (!from || !to || requestedAt === null) continue

      const transitModes = TRANSIT_MODES_BY_TRAVEL_MODE[announced.mode]

      try {
        const result = await clients.transitous.plan({
          from,
          to,
          time: requestedAt,
          transitModes,
        })
        const next = nextDeparture(result.itineraries, requestedAt, announced.mode, announced.line)
        const check: AnnouncedTravelCheck = {
          travelId: announced.id,
          requestedAt,
          transitModes,
          line: announced.line,
          nextDepartureAt: next?.at ?? null,
          evidence: {
            source: 'transitous',
            sourceDate: day.date,
            retrievedAt: now().toISOString(),
            url: result.url,
            attribution: transitousAttribution,
            raw: JSON.stringify(next?.itinerary ?? null),
            fields: {
              requestedAt,
              transitModes,
              line: announced.line,
              nextDepartureAt: next?.at ?? null,
              itinerariesReturned: result.itineraries.length,
            },
          },
        }

        travel.announced.push(check)
      } catch (error) {
        travel.unavailable.push({
          service: 'transitous',
          scope: announced.id,
          reason: reason(error),
        })
      }
    }
  }

  return travel
}
