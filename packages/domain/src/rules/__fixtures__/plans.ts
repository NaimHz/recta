import type { Coordinates, Evidence, Place, Plan, Stop, StopWindowSource } from '../../plan'
import { SCHEMA_VERSION } from '../../version'
import {
  NO_TRAVEL,
  type PlaceFact,
  type TransitLeg,
  type TravelFacts,
  type VerificationFacts,
  type WalkMatrix,
} from '../rule'

export const PARIS_FACTS: VerificationFacts = {
  city: {
    timezone: 'Europe/Paris',
    countryCode: 'FR',
    holidayRegion: 'Île-de-France',
    center: { lat: 48.8589, lon: 2.347 },
  },
  placeFacts: {},
  travel: NO_TRAVEL,
}

export const LYON_FACTS: VerificationFacts = {
  city: {
    timezone: 'Europe/Paris',
    countryCode: 'FR',
    holidayRegion: 'Auvergne-Rhône-Alpes',
    center: { lat: 45.7578, lon: 4.832 },
  },
  placeFacts: {},
  travel: NO_TRAVEL,
}

export function withPlaceFacts(
  facts: VerificationFacts,
  placeId: string,
  placeFacts: PlaceFact[],
): VerificationFacts {
  return { ...facts, placeFacts: { ...facts.placeFacts, [placeId]: placeFacts } }
}

export function curatedSource(url: string) {
  return { provider: 'curated' as const, url, sourceDate: '2026-11-03', retrievedAt: null }
}

export function osmPlace(name: string, raw: string | null, id = 'osm:node/1'): Place {
  return {
    id,
    name,
    coordinates: null,
    address: null,
    category: null,
    openingHoursRaw: raw,
    source: { provider: 'osm', sourceDate: '2026-10-23', retrievedAt: '2026-10-23T07:37:01.372Z' },
  }
}

export function stopAt(
  place: Place | null,
  start: string | null,
  end: string | null,
  windowSource: StopWindowSource = start === null ? 'unknown' : 'explicit',
): Stop {
  return {
    id: 'stop-1',
    name: place?.name ?? 'lieu inconnu',
    sourceText: null,
    type: null,
    resolution: place ? 'resolved' : 'not_found',
    place,
    start,
    end,
    windowSource,
  }
}

export function planOn(date: string | null, stop: Stop): Plan {
  return {
    schemaVersion: SCHEMA_VERSION,
    cityId: 'test-city',
    days: [{ id: 'day-1', date, timezone: 'Europe/Paris', stops: [stop] }],
    constraints: [],
  }
}

export const COORDINATES = {
  gareDuNord: { lat: 48.8809, lon: 2.3553 },
  louvre: { lat: 48.8606, lon: 2.3364 },
  cafeMarly: { lat: 48.8616428, lon: 2.3359304 },
  laDefense: { lat: 48.892, lon: 2.238 },
} satisfies Record<string, Coordinates>

export function locatedStop(
  id: string,
  coordinates: Coordinates | null,
  start: string | null,
  end: string | null,
  windowSource: StopWindowSource = start === null ? 'unknown' : 'explicit',
): Stop {
  return {
    id,
    name: id,
    sourceText: `${start ?? '?'}-${end ?? '?'} ${id}`,
    type: null,
    resolution: 'resolved',
    place: { ...osmPlace(id, null, `osm:node/${id}`), coordinates },
    start,
    end,
    windowSource,
  }
}

export function dayPlan(date: string | null, stops: Stop[]): Plan {
  return {
    schemaVersion: SCHEMA_VERSION,
    cityId: 'test-city',
    days: [{ id: 'day-1', date, timezone: 'Europe/Paris', stops }],
    constraints: [],
  }
}

function serviceEvidence(source: 'osrm' | 'transitous', url: string): Evidence {
  return {
    source,
    sourceDate: null,
    retrievedAt: '2026-11-03T09:47:00.000Z',
    url,
    attribution: source === 'osrm' ? 'OSRM FOSSGIS' : 'Transitous',
    raw: '{}',
    fields: {},
  }
}

export function walkMatrix(
  stopIds: string[],
  durationsSeconds: number[][],
  distancesMeters: number[][],
): WalkMatrix {
  return {
    dayId: 'day-1',
    stopIds,
    durationsSeconds,
    distancesMeters,
    evidence: serviceEvidence('osrm', 'https://routing.openstreetmap.de/routed-foot/table/v1/foot'),
  }
}

export function transitLeg(
  fromStopId: string,
  toStopId: string,
  departureAt: string,
  arrivalAt: string | null,
): TransitLeg {
  return {
    fromStopId,
    toStopId,
    departureAt,
    durationSeconds: arrivalAt ? (Date.parse(arrivalAt) - Date.parse(departureAt)) / 1000 : null,
    arrivalAt,
    transfers: arrivalAt ? 0 : null,
    modes: arrivalAt ? ['WALK', 'SUBWAY'] : [],
    evidence: serviceEvidence('transitous', 'https://api.transitous.org/api/v6/plan'),
  }
}

export function withTravel(
  facts: VerificationFacts,
  travel: Partial<TravelFacts>,
): VerificationFacts {
  return { ...facts, travel: { ...NO_TRAVEL, ...travel } }
}

export const GARE_LOUVRE_MARLY_WALK = walkMatrix(
  ['gare', 'louvre', 'marly'],
  [
    [0, 2457.3, 2368.3],
    [2457.3, 0, 88.8],
    [2368.3, 88.8, 0],
  ],
  [
    [0, 3072.5, 2961.2],
    [3072.5, 0, 111],
    [2961.2, 111, 0],
  ],
)

export const LOUVRE_DEFENSE_MARLY_WALK = walkMatrix(
  ['louvre', 'defense', 'marly'],
  [
    [0, 6889.2, 88.8],
    [6889.2, 0, 6808.6],
    [88.8, 6808.6, 0],
  ],
  [
    [0, 8656.7, 111],
    [8656.7, 0, 8555.7],
    [111, 8555.7, 0],
  ],
)
