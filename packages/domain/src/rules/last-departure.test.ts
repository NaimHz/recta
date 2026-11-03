import { describe, expect, it } from 'vitest'
import {
  COORDINATES,
  PARIS_FACTS,
  dayPlan,
  departureCheck,
  homeTravel,
  locatedStop,
  withTravel,
} from './__fixtures__/plans'
import { lastDeparture } from './last-departure'

const DATE = '2026-11-10'
const REQUESTED = '2026-11-10T23:15:00.000Z'
const bar = locatedStop('bar', COORDINATES.saintMichel, '23:30', '00:15')

function run(nextDepartureAt: string | null, line: string | null = null) {
  return lastDeparture.run({
    plan: dayPlan(DATE, [bar], [homeTravel('bar', '00:15', line)]),
    facts: withTravel(PARIS_FACTS, {
      announced: [departureCheck(REQUESTED, nextDepartureAt, line)],
    }),
  })
}

describe('lastDeparture', () => {
  it('signale un départ annoncé quand le prochain train n’est qu’au matin', () => {
    expect(run('2026-11-11T04:32:00Z', 'C')).toEqual([
      {
        kind: 'issue',
        issue: expect.objectContaining({
          id: 'last_departure_missed:bar',
          severity: 'error',
          message: 'Aucun RER C après 00:15 avant 05:32.',
          stopIds: ['bar'],
          evidence: [
            expect.objectContaining({
              source: 'transitous',
              fields: expect.objectContaining({
                quote: 'retour en RER C à 00:15',
                thresholdMinutes: 60,
              }),
            }),
          ],
        }),
      },
    ])
  })

  it('signale l’absence totale de départ', () => {
    expect(run(null)[0]).toMatchObject({
      kind: 'issue',
      issue: { message: 'Aucun départ en RER après 00:15.' },
    })
  })

  it('accepte un départ dans l’heure', () => {
    expect(run('2026-11-10T23:40:00Z')).toEqual([
      { kind: 'pass', code: 'last_departure_missed', stopIds: ['bar'] },
    ])
  })

  it.each([
    ['sans date', null, '00:15', COORDINATES.versaillesRiveGauche, 'date_unknown'],
    ['sans heure', DATE, null, COORDINATES.versaillesRiveGauche, 'time_unknown'],
    ['destination sans coordonnées', DATE, '00:15', null, 'missing_coordinates'],
    [
      'sans réponse Transitous',
      DATE,
      '00:15',
      COORDINATES.versaillesRiveGauche,
      'transit_unavailable',
    ],
  ])('rend indéterminé : %s', (_label, date, departure, coordinates, reason) => {
    const findings = lastDeparture.run({
      plan: dayPlan(date, [bar], [homeTravel('bar', departure, null, coordinates)]),
      facts: PARIS_FACTS,
    })

    expect(findings).toEqual([
      {
        kind: 'undetermined',
        undetermined: { codes: ['last_departure_missed'], stopIds: ['bar'], reason },
      },
    ])
  })
})
