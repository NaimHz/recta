import {
  type Day,
  type DayCode,
  type Evidence,
  type Issue,
  type Plan,
  type Stop,
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

function buildEvidence(day: Day, stop: Stop, weekday: DayCode): Evidence {
  const hours = stop.place.openingHours

  return {
    source: 'fixture',
    sourceDate: day.date,
    retrievedAt: null,
    raw: hours?.raw ?? '',
    fields: {
      placeName: stop.place.name,
      date: day.date,
      weekday,
      weekdayLabel: WEEKDAY_LABELS[weekday],
      opensAt: hours?.opensAt ?? null,
      closesAt: hours?.closesAt ?? null,
      closedOn: hours?.closedOn ?? [],
      stopStart: stop.start,
      stopEnd: stop.end,
    },
  }
}

function buildIssue(code: string, message: string, stop: Stop, evidence: Evidence): Issue {
  return {
    code,
    severity: 'error',
    message,
    stopId: stop.id,
    evidence,
  }
}

/**
 * Règle 1.7 : un stop doit tenir dans l'unique fenêtre d'ouverture du lieu.
 * Une fenêtre nocturne, plusieurs fenêtres et les jours fériés arrivent en 2.2.
 */
export function verifyOpeningHours(plan: Plan): VerificationResult {
  const issues: Issue[] = []
  let hasIndeterminateStop = false

  for (const day of plan.days) {
    const weekday = dayCodeForDate(day.date)

    for (const stop of day.stops) {
      const hours = stop.place.openingHours
      const evidence = buildEvidence(day, stop, weekday)

      if (!hours) {
        hasIndeterminateStop = true
        continue
      }

      if (hours.closedOn.includes(weekday)) {
        issues.push(
          buildIssue(
            'place_closed',
            `Le lieu ${stop.place.name} est fermé le ${WEEKDAY_LABELS[weekday]}.`,
            stop,
            evidence,
          ),
        )
        continue
      }

      if (stop.start < hours.opensAt) {
        issues.push(
          buildIssue(
            'stop_before_opening',
            `Le stop commence à ${stop.start}, avant l'ouverture de ${hours.opensAt}.`,
            stop,
            evidence,
          ),
        )
      }

      if (stop.end > hours.closesAt) {
        issues.push(
          buildIssue(
            'stop_after_closing',
            `Le stop finit à ${stop.end}, après la fermeture de ${hours.closesAt}.`,
            stop,
            evidence,
          ),
        )
      }
    }
  }

  const status = issues.length > 0 ? 'violation' : hasIndeterminateStop ? 'indéterminé' : 'conforme'

  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    plan,
    issues,
  }
}
