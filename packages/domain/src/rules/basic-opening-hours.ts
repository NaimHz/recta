import { dayCodeForDate } from '../opening-hours'
import type {
  DayCode,
  Evidence,
  EvidenceSource,
  Issue,
  IssueCode,
  IssueSeverity,
  Place,
  Stop,
  UndeterminedReason,
} from '../plan'
import type { Rule, RuleFinding } from './rule'

const WEEKDAY_LABELS: Record<DayCode, string> = {
  Mon: 'lundi',
  Tue: 'mardi',
  Wed: 'mercredi',
  Thu: 'jeudi',
  Fri: 'vendredi',
  Sat: 'samedi',
  Sun: 'dimanche',
}

const ATTRIBUTIONS: Partial<Record<EvidenceSource, string>> = {
  osm: '© OpenStreetMap contributors',
  google: 'Google Maps',
}

const CODES: IssueCode[] = ['place_closed_day', 'outside_opening_hours']

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

function issue(
  code: IssueCode,
  severity: IssueSeverity,
  message: string,
  stop: Stop,
  evidence: Evidence,
): RuleFinding {
  const built: Issue = {
    id: `${code}:${stop.id}`,
    code,
    severity,
    message,
    stopIds: [stop.id],
    evidence: [evidence],
  }

  return { kind: 'issue', issue: built }
}

function pass(code: IssueCode, stop: Stop): RuleFinding {
  return { kind: 'pass', code, stopIds: [stop.id] }
}

function undetermined(stop: Stop, codes: IssueCode[], reason: UndeterminedReason): RuleFinding {
  return { kind: 'undetermined', undetermined: { codes, stopIds: [stop.id], reason } }
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
export const basicOpeningHours: Rule = {
  id: 'basic-opening-hours',
  codes: CODES,
  run({ plan }) {
    const findings: RuleFinding[] = []

    for (const day of plan.days) {
      const date = day.date

      if (date === null) {
        for (const stop of day.stops) findings.push(undetermined(stop, CODES, 'date_unknown'))
        continue
      }

      const weekday = dayCodeForDate(date)

      for (const stop of day.stops) {
        const place = stop.place

        if (!place) {
          findings.push(undetermined(stop, CODES, 'place_unresolved'))
          continue
        }

        const hours = place.openingHours

        if (!hours) {
          findings.push(undetermined(stop, CODES, 'missing_hours'))
          continue
        }

        findings.push(
          hours.closedOn.includes(weekday)
            ? issue(
                'place_closed_day',
                'error',
                `Le lieu ${place.name} est fermé le ${WEEKDAY_LABELS[weekday]}.`,
                stop,
                buildEvidence(date, stop, place, weekday),
              )
            : pass('place_closed_day', stop),
        )

        if (stop.start === null || stop.end === null) {
          findings.push(undetermined(stop, ['outside_opening_hours'], 'time_unknown'))
          continue
        }

        const startsBefore = stop.start < hours.opensAt
        const endsAfter = stop.end < stop.start || stop.end > hours.closesAt

        if (!startsBefore && !endsAfter) {
          findings.push(pass('outside_opening_hours', stop))
          continue
        }

        const side: OutsideSide =
          startsBefore && endsAfter ? 'both' : startsBefore ? 'before_opening' : 'after_closing'

        findings.push(
          issue(
            'outside_opening_hours',
            stop.windowSource === 'explicit' ? 'error' : 'warning',
            outsideMessage(side, stop, hours.opensAt, hours.closesAt),
            stop,
            buildEvidence(date, stop, place, weekday, { side }),
          ),
        )
      }
    }

    return findings
  },
}
