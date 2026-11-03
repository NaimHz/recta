import { dayOpenIntervals } from '../opening-hours-engine'
import type { Rule, RuleFinding } from './rule'
import {
  datedStops,
  factEvidence,
  hoursEvidence,
  issueFinding,
  openingHoursContext,
  passFinding,
  placeFact,
  severityForWindow,
  toUndeterminedReason,
  undeterminedFinding,
} from './support'

function toMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)

  return hours * 60 + minutes
}

function toTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export const lastEntry: Rule = {
  id: 'last-entry',
  codes: ['after_last_entry'],
  run({ plan, facts }) {
    const findings: RuleFinding[] = []
    const code = 'after_last_entry'

    for (const { date, stop } of datedStops(plan)) {
      const place = stop.place

      if (!place) continue

      const fact = placeFact(facts, place, 'last_entry_before_close_minutes')

      if (!fact) continue

      if (date === null) {
        findings.push(undeterminedFinding([code], [stop.id], 'date_unknown'))
        continue
      }

      if (stop.start === null) {
        findings.push(undeterminedFinding([code], [stop.id], 'time_unknown'))
        continue
      }

      const start = stop.start
      const day = dayOpenIntervals(place.openingHoursRaw, openingHoursContext(facts, place), date)

      if (day.status === 'indéterminé') {
        findings.push(undeterminedFinding([code], [stop.id], toUndeterminedReason(day.reason)))
        continue
      }

      const interval = day.intervals.find((entry) => entry.start <= start && start < entry.end)

      if (!interval) continue

      const lastEntryAt = toTime(toMinutes(interval.end) - fact.value)

      if (start <= lastEntryAt) {
        findings.push(passFinding(code, [stop.id]))
        continue
      }

      findings.push(
        issueFinding(
          code,
          severityForWindow(stop.windowSource),
          `Le stop commence à ${start}, après la dernière entrée de ${lastEntryAt} (fermeture à ${interval.end}).`,
          [stop.id],
          [
            factEvidence(fact, { placeName: place.name }),
            hoursEvidence(place, {
              date,
              stopStart: start,
              closesAt: interval.end,
              lastEntryAt,
            }),
          ],
        ),
      )
    }

    return findings
  },
}
