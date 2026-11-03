import type { Place, Plan, Stop, StopWindowSource } from '../../plan'
import { SCHEMA_VERSION } from '../../version'
import type { PlaceFact, VerificationFacts } from '../rule'

export const PARIS_FACTS: VerificationFacts = {
  city: {
    timezone: 'Europe/Paris',
    countryCode: 'FR',
    holidayRegion: 'Île-de-France',
    center: { lat: 48.8589, lon: 2.347 },
  },
  placeFacts: {},
}

export const LYON_FACTS: VerificationFacts = {
  city: {
    timezone: 'Europe/Paris',
    countryCode: 'FR',
    holidayRegion: 'Auvergne-Rhône-Alpes',
    center: { lat: 45.7578, lon: 4.832 },
  },
  placeFacts: {},
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
