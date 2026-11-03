import type { Evidence, IssueCode, Stop } from '../plan'
import type { Rule, RuleFinding, TravelFacts } from './rule'
import {
  issueFinding,
  passFinding,
  stopBounds,
  toMinutes,
  undeterminedFinding,
  writtenSeverity,
} from './support'

export const TRAVEL_MARGIN_MINUTES = 10

const CODES: IssueCode[] = ['travel_time_infeasible', 'insufficient_buffer']

type WalkLookup = { seconds: number; evidence: Evidence }

function walkBetween(travel: TravelFacts, dayId: string, from: Stop, to: Stop): WalkLookup | null {
  const matrix = travel.walk.find((entry) => entry.dayId === dayId)

  if (!matrix) return null

  const row = matrix.stopIds.indexOf(from.id)
  const column = matrix.stopIds.indexOf(to.id)
  const seconds = matrix.durationsSeconds[row]?.[column]

  if (row < 0 || column < 0 || seconds === null || seconds === undefined) return null

  return { seconds, evidence: matrix.evidence }
}

export const travelTime: Rule = {
  id: 'travel-time',
  codes: CODES,
  run({ plan, facts }) {
    const findings: RuleFinding[] = []

    for (const day of plan.days) {
      for (let index = 1; index < day.stops.length; index += 1) {
        const from = day.stops[index - 1]
        const to = day.stops[index]

        if (!from || !to) continue

        const stopIds = [from.id, to.id]
        const fromBounds = stopBounds(day.date, from, facts.city.timezone)
        const toBounds = stopBounds(day.date, to, facts.city.timezone)

        if (!fromBounds || !toBounds) {
          findings.push(undeterminedFinding(CODES, stopIds, 'time_unknown'))
          continue
        }

        const gapMs = toBounds.startMs - fromBounds.endMs

        if (gapMs < 0) continue

        if (!from.place || !to.place) {
          findings.push(undeterminedFinding(CODES, stopIds, 'place_unresolved'))
          continue
        }

        if (!from.place.coordinates || !to.place.coordinates) {
          findings.push(undeterminedFinding(CODES, stopIds, 'missing_coordinates'))
          continue
        }

        const walk = walkBetween(facts.travel, day.id, from, to)
        const transit = facts.travel.transit.find(
          (leg) => leg.fromStopId === from.id && leg.toStopId === to.id,
        )
        const walkArrival = walk ? fromBounds.endMs + walk.seconds * 1000 : null
        const transitArrival = transit?.arrivalAt ? Date.parse(transit.arrivalAt) : null
        const marginMs = TRAVEL_MARGIN_MINUTES * 60_000

        if (!walk || !transit) {
          if (walkArrival !== null && walkArrival + marginMs <= toBounds.startMs) {
            findings.push(passFinding('travel_time_infeasible', stopIds))
            findings.push(passFinding('insufficient_buffer', stopIds))
          } else {
            findings.push(undeterminedFinding(CODES, stopIds, 'transit_unavailable'))
          }
          continue
        }

        const useTransit =
          transitArrival !== null && walkArrival !== null && transitArrival < walkArrival
        const arrival = useTransit ? (transitArrival as number) : (walkArrival as number)
        const mode = useTransit ? 'transit' : 'walk'
        const travelMinutes = Math.ceil((arrival - fromBounds.endMs) / 60_000)
        const gapMinutes = toMinutes(gapMs)
        const modeLabel = useTransit ? 'en transports en commun' : 'à pied'
        const fields = {
          from: from.name,
          to: to.name,
          gapMinutes,
          travelMinutes,
          mode,
          marginMinutes: TRAVEL_MARGIN_MINUTES,
        }
        const evidence = [walk.evidence, ...(useTransit ? [transit.evidence] : [])].map(
          (entry) => ({ ...entry, fields: { ...entry.fields, ...fields } }),
        )

        if (arrival > toBounds.startMs) {
          findings.push(
            issueFinding(
              'travel_time_infeasible',
              writtenSeverity([from, to]),
              `De ${from.name} à ${to.name} : ${travelMinutes} min au plus vite ${modeLabel}, le plan en laisse ${gapMinutes}.`,
              stopIds,
              evidence,
            ),
          )
          continue
        }

        findings.push(passFinding('travel_time_infeasible', stopIds))

        if (arrival + marginMs > toBounds.startMs) {
          findings.push(
            issueFinding(
              'insufficient_buffer',
              'warning',
              `De ${from.name} à ${to.name} : ${travelMinutes} min ${modeLabel} pour ${gapMinutes} min d'écart, moins de ${TRAVEL_MARGIN_MINUTES} min de marge.`,
              stopIds,
              evidence,
            ),
          )
          continue
        }

        findings.push(passFinding('insufficient_buffer', stopIds))
      }
    }

    return findings
  },
}
