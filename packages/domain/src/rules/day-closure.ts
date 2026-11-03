import { dayOpenIntervals, type OpeningHoursContext } from '../opening-hours-engine'
import type { IssueCode, Place } from '../plan'
import type { Rule, RuleFinding } from './rule'
import {
  addDays,
  datedStops,
  hoursEvidence,
  issueFinding,
  openingHoursContext,
  passFinding,
  toUndeterminedReason,
  undeterminedFinding,
} from './support'

const CODES: IssueCode[] = ['place_closed_day', 'holiday_closure']
const REFERENCE_WEEKS = 4

function openReferenceDay(
  place: Place,
  context: OpeningHoursContext,
  date: string,
): { date: string; open: boolean } | null {
  for (let week = 1; week <= REFERENCE_WEEKS; week += 1) {
    const candidate = addDays(date, week * 7)
    const day = dayOpenIntervals(place.openingHoursRaw, context, candidate)

    if (day.status === 'known' && !day.holiday) {
      return { date: candidate, open: day.intervals.length > 0 }
    }
  }

  return null
}

export const dayClosure: Rule = {
  id: 'day-closure',
  codes: CODES,
  run({ plan, facts }) {
    const findings: RuleFinding[] = []

    for (const { date, stop } of datedStops(plan)) {
      const place = stop.place

      if (date === null) {
        findings.push(undeterminedFinding(CODES, [stop.id], 'date_unknown'))
        continue
      }

      if (!place) {
        findings.push(undeterminedFinding(CODES, [stop.id], 'place_unresolved'))
        continue
      }

      const context = openingHoursContext(facts, place)
      const day = dayOpenIntervals(place.openingHoursRaw, context, date)

      if (day.status === 'indéterminé') {
        findings.push(undeterminedFinding(CODES, [stop.id], toUndeterminedReason(day.reason)))
        continue
      }

      if (day.intervals.length > 0) {
        findings.push(passFinding('place_closed_day', [stop.id]))
        findings.push(passFinding('holiday_closure', [stop.id]))
        continue
      }

      const reference = day.holiday ? openReferenceDay(place, context, date) : null

      if (reference?.open) {
        findings.push(passFinding('place_closed_day', [stop.id]))
        findings.push(
          issueFinding(
            'holiday_closure',
            'error',
            `Le lieu ${place.name} est fermé le ${date}, jour férié ; il est ouvert le ${reference.date}.`,
            [stop.id],
            [
              hoursEvidence(place, { date, referenceDate: reference.date }),
              {
                source: 'calendar',
                sourceDate: date,
                retrievedAt: null,
                url: null,
                attribution: null,
                raw: date,
                fields: { date, holiday: true, holidayRegion: facts.city.holidayRegion },
              },
            ],
          ),
        )
        continue
      }

      findings.push(
        issueFinding(
          'place_closed_day',
          'error',
          `Le lieu ${place.name} est fermé toute la journée du ${date}.`,
          [stop.id],
          [hoursEvidence(place, { date, holiday: day.holiday })],
        ),
      )
      findings.push(passFinding('holiday_closure', [stop.id]))
    }

    return findings
  },
}
