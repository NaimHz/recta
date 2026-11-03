import { localDateTimeInTimezone } from '../opening-hours-engine'
import type { AnnouncedTravel, Day, TravelMode } from '../plan'
import type { Rule, RuleFinding } from './rule'
import { issueFinding, passFinding, undeterminedFinding } from './support'

export const LAST_DEPARTURE_WAIT_MINUTES = 60

const MODE_LABELS: Record<TravelMode, string> = {
  metro: 'métro',
  rer: 'RER',
  train: 'train',
  tram: 'tram',
  bus: 'bus',
  transit: 'transport en commun',
}

function stopIdsFor(travel: AnnouncedTravel): string[] {
  return travel.toStopId === null ? [travel.fromStopId] : [travel.fromStopId, travel.toStopId]
}

function hasCoordinates(day: Day, travel: AnnouncedTravel): boolean {
  const from = day.stops.find((stop) => stop.id === travel.fromStopId)?.place?.coordinates
  const to =
    travel.toStopId === null
      ? travel.toPlace?.coordinates
      : day.stops.find((stop) => stop.id === travel.toStopId)?.place?.coordinates

  return Boolean(from && to)
}

export const lastDeparture: Rule = {
  id: 'last-departure',
  codes: ['last_departure_missed'],
  run({ plan, facts }) {
    const findings: RuleFinding[] = []
    const code = 'last_departure_missed'

    for (const day of plan.days) {
      for (const travel of day.travels) {
        const stopIds = stopIdsFor(travel)

        if (day.date === null) {
          findings.push(undeterminedFinding([code], stopIds, 'date_unknown'))
          continue
        }

        if (travel.departure === null) {
          findings.push(undeterminedFinding([code], stopIds, 'time_unknown'))
          continue
        }

        if (!hasCoordinates(day, travel)) {
          findings.push(undeterminedFinding([code], stopIds, 'missing_coordinates'))
          continue
        }

        const check = facts.travel.announced.find((entry) => entry.travelId === travel.id)

        if (!check) {
          findings.push(undeterminedFinding([code], stopIds, 'transit_unavailable'))
          continue
        }

        const waitMinutes =
          check.nextDepartureAt === null
            ? null
            : (Date.parse(check.nextDepartureAt) - Date.parse(check.requestedAt)) / 60_000

        if (waitMinutes !== null && waitMinutes <= LAST_DEPARTURE_WAIT_MINUTES) {
          findings.push(passFinding(code, stopIds))
          continue
        }

        const label = `${MODE_LABELS[travel.mode]}${travel.line ? ` ${travel.line}` : ''}`
        const next =
          check.nextDepartureAt === null
            ? null
            : localDateTimeInTimezone(new Date(check.nextDepartureAt), facts.city.timezone)

        findings.push(
          issueFinding(
            code,
            'error',
            next
              ? `Aucun ${label} après ${travel.departure} avant ${next.time}.`
              : `Aucun départ en ${label} après ${travel.departure}.`,
            stopIds,
            [
              {
                ...check.evidence,
                fields: {
                  ...check.evidence.fields,
                  mode: travel.mode,
                  line: travel.line,
                  announcedDeparture: travel.departure,
                  quote: travel.sourceText,
                  thresholdMinutes: LAST_DEPARTURE_WAIT_MINUTES,
                },
              },
            ],
          ),
        )
      }
    }

    return findings
  },
}
