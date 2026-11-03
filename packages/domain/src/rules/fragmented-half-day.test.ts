import { describe, expect, it } from 'vitest'
import {
  COORDINATES,
  LOUVRE_DEFENSE_MARLY_WALK,
  PARIS_FACTS,
  dayPlan,
  locatedStop,
  withTravel,
} from './__fixtures__/plans'
import { fragmentedHalfDay } from './fragmented-half-day'

const facts = withTravel(PARIS_FACTS, { walk: [LOUVRE_DEFENSE_MARLY_WALK] })

function plan(marlyStart: string) {
  return dayPlan('2026-11-10', [
    locatedStop('louvre', COORDINATES.louvre, '09:00', '11:00'),
    locatedStop('defense', COORDINATES.laDefense, '11:45', '12:45'),
    locatedStop('marly', COORDINATES.cafeMarly, marlyStart, '14:30'),
  ])
}

describe('fragmentedHalfDay', () => {
  it('signale un aller-retour à travers la ville dans la même demi-journée', () => {
    const findings = fragmentedHalfDay.run({ plan: plan('13:30'), facts })

    expect(findings).toEqual([
      {
        kind: 'issue',
        issue: expect.objectContaining({
          id: 'fragmented_half_day:louvre,defense,marly',
          severity: 'warning',
          message:
            "louvre → defense → marly : 8657 m à l'aller, puis retour à 111 m du point de départ en moins de 4 h.",
          evidence: [
            expect.objectContaining({
              source: 'osrm',
              fields: expect.objectContaining({
                distanceOutMeters: 8656.7,
                distanceBackMeters: 111,
              }),
            }),
          ],
        }),
      },
    ])
  })

  it('ne signale rien au-delà de la fenêtre de 4 heures', () => {
    expect(fragmentedHalfDay.run({ plan: plan('15:30'), facts })).toEqual([])
  })

  it('rend indéterminé un jour sans matrice', () => {
    expect(fragmentedHalfDay.run({ plan: plan('13:30'), facts: PARIS_FACTS })).toEqual([
      {
        kind: 'undetermined',
        undetermined: {
          codes: ['fragmented_half_day'],
          stopIds: ['louvre', 'defense', 'marly'],
          reason: 'transit_unavailable',
        },
      },
    ])
  })
})
