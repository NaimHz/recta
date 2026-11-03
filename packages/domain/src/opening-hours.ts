import {
  type DayCode,
  type Evidence,
  type EvidenceSource,
  type Issue,
  type IssueCode,
  type IssueSeverity,
  type Place,
  type Plan,
  type Stop,
  type Undetermined,
  type UndeterminedReason,
  type VerificationResult,
} from './plan'
import { SCHEMA_VERSION } from './version'

const JS_DAY_TO_CODE: readonly DayCode[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const WEEKDAY_LABELS: Record<DayCode, string> = {
  Mon: 'lundi',
  Tue: 'mardi',
  Wed: 'mercredi',
  Thu: 'jeudi',
  Fri: 'vendredi',
  Sat: 'samedi',
  Sun: 'dimanche',
}

export function dayCodeForDate(date: string): DayCode {
  const jsDay = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  const code = JS_DAY_TO_CODE[jsDay]

  if (!code) {
    throw new Error(`Jour invalide pour la date ${date}`)
  }

  return code
}

const ATTRIBUTIONS: Partial<Record<EvidenceSource, string>> = {
  osm: '© OpenStreetMap contributors',
  google: 'Google Maps',
}

const OPENING_HOURS_CODES: IssueCode[] = ['place_closed_day', 'outside_opening_hours']

type OutsideSide = 'before_opening' | 'after_closing' | 'both'

function buildEvidence(
  date: string,
  stop: Stop,
  place: Place,
  weekday: DayCode,
  extraFields: Record<string, unknown> = {},
): Evidence {
  const hours = place.openingHours

  return {
    source: place.source.provider,
    sourceDate: place.source.sourceDate,
    retrievedAt: place.source.retrievedAt,
    url: null,
    attribution: ATTRIBUTIONS[place.source.provider] ?? null,
    raw: place.openingHoursRaw ?? hours?.raw ?? '',
    fields: {
      placeName: place.name,
      date,
      weekday,
      weekdayLabel: WEEKDAY_LABELS[weekday],
      opensAt: hours?.opensAt ?? null,
      closesAt: hours?.closesAt ?? null,
      closedOn: hours?.closedOn ?? [],
      stopStart: stop.start,
      stopEnd: stop.end,
      ...extraFields,
    },
  }
}

function buildIssue(
  code: IssueCode,
  severity: IssueSeverity,
  message: string,
  stop: Stop,
  evidence: Evidence,
): Issue {
  return {
    id: `${code}:${stop.id}`,
    code,
    severity,
    message,
    stopIds: [stop.id],
    evidence: [evidence],
  }
}

function undetermined(stop: Stop, codes: IssueCode[], reason: UndeterminedReason): Undetermined {
  return { codes, stopIds: [stop.id], reason }
}

function outsideMessage(side: OutsideSide, stop: Stop, opensAt: string, closesAt: string): string {
  const before = `Le stop commence à ${stop.start}, avant l'ouverture de ${opensAt}.`
  const after = `Le stop finit à ${stop.end}, après la fermeture de ${closesAt}.`

  if (side === 'before_opening') return before
  if (side === 'after_closing') return after

  return `${before} ${after}`
}

/**
 * Règle 1.7 : un stop doit tenir dans l'unique fenêtre d'ouverture du lieu.
 * Une fenêtre nocturne, plusieurs fenêtres et les jours fériés arrivent en 2.2.
 */
export function verifyOpeningHours(plan: Plan): VerificationResult {
  const issues: Issue[] = []
  const undeterminedChecks: Undetermined[] = []

  for (const day of plan.days) {
    const date = day.date

    if (date === null) {
      for (const stop of day.stops) {
        undeterminedChecks.push(undetermined(stop, OPENING_HOURS_CODES, 'date_unknown'))
      }
      continue
    }

    const weekday = dayCodeForDate(date)

    for (const stop of day.stops) {
      const place = stop.place

      if (!place) {
        undeterminedChecks.push(undetermined(stop, OPENING_HOURS_CODES, 'place_unresolved'))
        continue
      }

      const hours = place.openingHours

      if (!hours) {
        undeterminedChecks.push(undetermined(stop, OPENING_HOURS_CODES, 'missing_hours'))
        continue
      }

      if (hours.closedOn.includes(weekday)) {
        issues.push(
          buildIssue(
            'place_closed_day',
            'error',
            `Le lieu ${place.name} est fermé le ${WEEKDAY_LABELS[weekday]}.`,
            stop,
            buildEvidence(date, stop, place, weekday),
          ),
        )
        continue
      }

      if (stop.start === null || stop.end === null) {
        undeterminedChecks.push(undetermined(stop, ['outside_opening_hours'], 'time_unknown'))
        continue
      }

      const startsBefore = stop.start < hours.opensAt
      const endsAfter = stop.end < stop.start || stop.end > hours.closesAt

      if (!startsBefore && !endsAfter) continue

      const side: OutsideSide =
        startsBefore && endsAfter ? 'both' : startsBefore ? 'before_opening' : 'after_closing'

      issues.push(
        buildIssue(
          'outside_opening_hours',
          stop.windowSource === 'explicit' ? 'error' : 'warning',
          outsideMessage(side, stop, hours.opensAt, hours.closesAt),
          stop,
          buildEvidence(date, stop, place, weekday, { side }),
        ),
      )
    }
  }

  const status =
    issues.length > 0 ? 'violation' : undeterminedChecks.length > 0 ? 'indéterminé' : 'conforme'

  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    plan,
    issues,
    undetermined: undeterminedChecks,
  }
}
