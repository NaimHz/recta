import type { OpeningHoursContext, OpeningHoursReason } from '../opening-hours-engine'
import { UNDETERMINED_REASONS } from '../plan'
import type {
  Evidence,
  EvidenceSource,
  IssueCode,
  IssueSeverity,
  Place,
  Plan,
  Stop,
  StopWindowSource,
  UndeterminedReason,
} from '../plan'
import type { PlaceFact, RuleFinding, VerificationFacts } from './rule'

const ATTRIBUTIONS: Partial<Record<EvidenceSource, string>> = {
  osm: '© OpenStreetMap contributors',
  google: 'Google Maps',
}

const UNDETERMINED_REASON_SET = new Set<string>(UNDETERMINED_REASONS)

export function toUndeterminedReason(reason: OpeningHoursReason): UndeterminedReason {
  return UNDETERMINED_REASON_SET.has(reason) ? (reason as UndeterminedReason) : 'unknown'
}

export type DatedStop = {
  date: string | null
  stop: Stop
}

export function datedStops(plan: Plan): DatedStop[] {
  return plan.days.flatMap((day) => day.stops.map((stop) => ({ date: day.date, stop })))
}

export function issueFinding(
  code: IssueCode,
  severity: IssueSeverity,
  message: string,
  stopIds: string[],
  evidence: Evidence[],
): RuleFinding {
  return {
    kind: 'issue',
    issue: { id: `${code}:${stopIds.join(',')}`, code, severity, message, stopIds, evidence },
  }
}

export function passFinding(code: IssueCode, stopIds: string[]): RuleFinding {
  return { kind: 'pass', code, stopIds }
}

export function undeterminedFinding(
  codes: IssueCode[],
  stopIds: string[],
  reason: UndeterminedReason,
): RuleFinding {
  return { kind: 'undetermined', undetermined: { codes, stopIds, reason } }
}

export function severityForWindow(windowSource: StopWindowSource): IssueSeverity {
  return windowSource === 'explicit' ? 'error' : 'warning'
}

export function openingHoursContext(facts: VerificationFacts, place: Place): OpeningHoursContext {
  return {
    timezone: facts.city.timezone,
    countryCode: facts.city.countryCode,
    holidayRegion: facts.city.holidayRegion,
    coordinates: place.coordinates ?? facts.city.center,
  }
}

export function placeFact<K extends PlaceFact['key']>(
  facts: VerificationFacts,
  place: Place,
  key: K,
): Extract<PlaceFact, { key: K }> | null {
  const fact = facts.placeFacts[place.id]?.find((entry) => entry.key === key)

  return (fact as Extract<PlaceFact, { key: K }> | undefined) ?? null
}

export function hoursEvidence(place: Place, fields: Record<string, unknown>): Evidence {
  return {
    source: place.source.provider,
    sourceDate: place.source.sourceDate,
    retrievedAt: place.source.retrievedAt,
    url: null,
    attribution: ATTRIBUTIONS[place.source.provider] ?? null,
    raw: place.openingHoursRaw ?? '',
    fields: { placeName: place.name, ...fields },
  }
}

export function factEvidence(fact: PlaceFact, fields: Record<string, unknown>): Evidence {
  return {
    source: fact.source.provider,
    sourceDate: fact.source.sourceDate,
    retrievedAt: fact.source.retrievedAt,
    url: fact.source.url,
    attribution: ATTRIBUTIONS[fact.source.provider] ?? null,
    raw: String(fact.value),
    fields: { [fact.key]: fact.value, ...fields },
  }
}
