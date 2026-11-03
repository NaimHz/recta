import {
  checkOpeningHoursWindow,
  dayOpenIntervals,
  type OpeningInterval,
} from '../opening-hours-engine'
import type { IssueSeverity, Place, Stop } from '../plan'
import type { Rule, RuleFinding } from './rule'
import {
  datedStops,
  hoursEvidence,
  issueFinding,
  openingHoursContext,
  passFinding,
  severityForWindow,
  toUndeterminedReason,
  undeterminedFinding,
} from './support'

type Side = 'before_opening' | 'after_closing'

function boundaries(
  intervals: OpeningInterval[],
  start: string,
): { opensAt: string | null; closesAt: string | null } {
  const current = intervals.find((interval) => interval.start <= start && start < interval.end)
  const next = intervals.find((interval) => interval.start > start)

  return { opensAt: current?.start ?? next?.start ?? null, closesAt: current?.end ?? null }
}

function message(side: Side, stop: Stop, opensAt: string | null, closesAt: string | null): string {
  if (side === 'after_closing') {
    return `Le stop finit à ${stop.end}, après la fermeture${closesAt ? ` de ${closesAt}` : ''}.`
  }

  return `Le stop commence à ${stop.start}, lieu fermé${opensAt ? ` (ouverture à ${opensAt})` : ''}.`
}

function outside(
  place: Place,
  stop: Stop,
  date: string,
  side: Side,
  severity: IssueSeverity,
  intervals: OpeningInterval[],
): RuleFinding {
  const { opensAt, closesAt } = boundaries(intervals, stop.start ?? '00:00')

  return issueFinding(
    'outside_opening_hours',
    severity,
    message(side, stop, opensAt, closesAt),
    [stop.id],
    [
      hoursEvidence(place, {
        date,
        stopStart: stop.start,
        stopEnd: stop.end,
        side,
        opensAt,
        closesAt,
      }),
    ],
  )
}

export const openingWindow: Rule = {
  id: 'opening-window',
  codes: ['outside_opening_hours'],
  run({ plan, facts }) {
    const findings: RuleFinding[] = []
    const code = 'outside_opening_hours'

    for (const { date, stop } of datedStops(plan)) {
      const place = stop.place

      if (date === null) {
        findings.push(undeterminedFinding([code], [stop.id], 'date_unknown'))
        continue
      }

      if (!place) {
        findings.push(undeterminedFinding([code], [stop.id], 'place_unresolved'))
        continue
      }

      if (stop.start === null || stop.end === null) {
        findings.push(undeterminedFinding([code], [stop.id], 'time_unknown'))
        continue
      }

      const context = openingHoursContext(facts, place)
      const day = dayOpenIntervals(place.openingHoursRaw, context, date)
      const intervals = day.status === 'known' ? day.intervals : []

      if (stop.windowSource === 'period') {
        if (day.status === 'indéterminé') {
          findings.push(undeterminedFinding([code], [stop.id], toUndeterminedReason(day.reason)))
          continue
        }

        const start = stop.start
        const end = stop.end
        const overlaps = intervals.some((interval) => interval.start < end && start < interval.end)

        findings.push(
          overlaps
            ? passFinding(code, [stop.id])
            : outside(place, stop, date, 'before_opening', 'error', intervals),
        )
        continue
      }

      const check = checkOpeningHoursWindow(place.openingHoursRaw, context, {
        date,
        start: stop.start,
        end: stop.end,
      })

      if (check.status === 'conforme') {
        findings.push(passFinding(code, [stop.id]))
        continue
      }

      if (check.status === 'indéterminé') {
        findings.push(undeterminedFinding([code], [stop.id], toUndeterminedReason(check.reason)))
        continue
      }

      findings.push(
        outside(
          place,
          stop,
          date,
          check.reason === 'closes_during_stop' ? 'after_closing' : 'before_opening',
          severityForWindow(stop.windowSource),
          intervals,
        ),
      )
    }

    return findings
  },
}
