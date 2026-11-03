import type { Rule, RuleFinding } from './rule'
import {
  datedStops,
  factEvidence,
  issueFinding,
  passFinding,
  placeFact,
  undeterminedFinding,
} from './support'

const CLOSED_LABELS = {
  closed_temporarily: 'temporairement',
  closed_permanently: 'définitivement',
} as const

export const placeStatus: Rule = {
  id: 'place-status',
  codes: ['place_not_operating'],
  run({ plan, facts }) {
    const findings: RuleFinding[] = []

    for (const { date, stop } of datedStops(plan)) {
      const place = stop.place

      if (!place) continue

      const fact = placeFact(facts, place, 'business_status')

      if (!fact) continue

      if (fact.value === 'unknown') {
        findings.push(undeterminedFinding(['place_not_operating'], [stop.id], 'unknown'))
        continue
      }

      if (fact.value === 'operational') {
        findings.push(passFinding('place_not_operating', [stop.id]))
        continue
      }

      findings.push(
        issueFinding(
          'place_not_operating',
          'error',
          `Le lieu ${place.name} est fermé ${CLOSED_LABELS[fact.value]}.`,
          [stop.id],
          [factEvidence(fact, { placeName: place.name, businessStatus: fact.value, date })],
        ),
      )
    }

    return findings
  },
}
